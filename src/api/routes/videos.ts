import _ from 'lodash';
import path from "path";
import fs from "fs-extra";
import mime from "mime";

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { tokenSplit } from '@/api/controllers/core.ts';
import { generateVideo, generateSeedanceVideo, isSeedanceModel, DEFAULT_MODEL, submitVideoTask, submitSeedanceVideoTask } from '@/api/controllers/videos.ts';
import util from '@/lib/util.ts';
import {
  generateVideoName,
  insertTask,
} from "@/lib/video-task-db.ts";

export default {

    prefix: '/v1/videos',

    post: {

        '/generations': async (request: Request) => {
            // 检查是否使用了不支持的参数
            const unsupportedParams = ['size', 'width', 'height'];
            const bodyKeys = Object.keys(request.body);
            const foundUnsupported = unsupportedParams.filter(param => bodyKeys.includes(param));

            if (foundUnsupported.length > 0) {
                throw new Error(`不支持的参数: ${foundUnsupported.join(', ')}。请使用 ratio 和 resolution 参数控制视频尺寸。`);
            }

            const contentType = request.headers['content-type'] || '';
            const isMultiPart = contentType.startsWith('multipart/form-data');

            request
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.prompt', v => _.isUndefined(v) || _.isString(v))
                .validate('body.ratio', v => _.isUndefined(v) || _.isString(v))
                .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
                .validate('body.duration', v => {
                    if (_.isUndefined(v)) return true;
                    // 对于 multipart/form-data，允许字符串类型的数字
                    if (isMultiPart && typeof v === 'string') {
                        const num = parseInt(v);
                        // Seedance 支持 4-15 秒连续范围，普通视频支持 5 或 10 秒
                        return (num >= 4 && num <= 15) || num === 5 || num === 10;
                    }
                    // 对于 JSON，要求数字类型
                    // Seedance 支持 4-15 秒连续范围，普通视频支持 5 或 10 秒
                    return _.isFinite(v) && ((v >= 4 && v <= 15) || v === 5 || v === 10);
                })
                .validate('body.file_paths', v => _.isUndefined(v) || _.isArray(v))
                .validate('body.filePaths', v => _.isUndefined(v) || _.isArray(v))
                .validate('body.response_format', v => _.isUndefined(v) || _.isString(v))
                .validate('headers.authorization', _.isString);

            // refresh_token切分
            const tokens = tokenSplit(request.headers.authorization);
            // 随机挑选一个refresh_token
            const token = _.sample(tokens);

            const {
                model = DEFAULT_MODEL,
                prompt,
                ratio = "1:1",
                resolution = "720p",
                duration = 5,
                file_paths = [],
                filePaths = [],
                response_format = "url"
            } = request.body;

            // 如果是 multipart/form-data，需要将字符串转换为数字
            const finalDuration = isMultiPart && typeof duration === 'string'
                ? parseInt(duration)
                : duration;

            // 兼容两种参数名格式：file_paths 和 filePaths
            const finalFilePaths = filePaths.length > 0 ? filePaths : file_paths;

            // 根据模型类型选择不同的生成函数
            let videoUrl: string;
            if (isSeedanceModel(model)) {
                // Seedance 2.0 多图智能视频生成
                // Seedance 默认时长为 4 秒，默认比例为 4:3
                const seedanceDuration = finalDuration === 5 ? 4 : finalDuration; // 如果是默认的5秒，转为4秒
                const seedanceRatio = ratio === "1:1" ? "4:3" : ratio; // 如果是默认的1:1，转为4:3

                videoUrl = await generateSeedanceVideo(
                    model,
                    prompt,
                    {
                        ratio: seedanceRatio,
                        resolution,
                        duration: seedanceDuration,
                        filePaths: finalFilePaths,
                        files: request.files,
                    },
                    token
                );
            } else {
                // 普通视频生成
                videoUrl = await generateVideo(
                    model,
                    prompt,
                    {
                        ratio,
                        resolution,
                        duration: finalDuration,
                        filePaths: finalFilePaths,
                        files: request.files,
                    },
                    token
                );
            }

            // 根据response_format返回不同格式的结果
            if (response_format === "b64_json") {
                // 获取视频内容并转换为BASE64
                const videoBase64 = await util.fetchFileBASE64(videoUrl);
                return {
                    created: util.unixTimestamp(),
                    data: [{
                        b64_json: videoBase64,
                        revised_prompt: prompt
                    }]
                };
            } else {
                // 默认返回URL
                return {
                    created: util.unixTimestamp(),
                    data: [{
                        url: videoUrl,
                        revised_prompt: prompt
                    }]
                };
            }
        },

        '/storyboard': async (request: Request) => {
            request
                .validate('body.storyboard_path', v => _.isString(v) && v.length > 0)
                .validate('body.parentpath', v => _.isString(v) && v.length > 0)
                .validate('body.save_path', v => _.isString(v) && v.length > 0)
                .validate('body.model', v => _.isUndefined(v) || _.isString(v))
                .validate('body.resolution', v => _.isUndefined(v) || _.isString(v))
                .validate('headers.authorization', _.isString);

            const tokens = tokenSplit(request.headers.authorization);
            const token = _.sample(tokens);

            const {
                storyboard_path,
                parentpath,
                save_path,
                model = 'jimeng-video-seedance-2.0',
                resolution = '720p',
            } = request.body;

            // 读取分镜 JSON
            if (!await fs.pathExists(storyboard_path)) {
                throw new Error(`storyboard_path 不存在: ${storyboard_path}`);
            }
            const storyboard = JSON.parse(await fs.readFile(storyboard_path, 'utf-8'));

            const {
                episode,
                video_number,
                title,
                style = '',
                references = '',
                timeline = '',
                sound_effects = '',
                music = '',
                aspect_ratio,
                duration_seconds,
                reference_images = [],
            } = storyboard;

            // 拼装 prompt
            const prompt = [
                style,
                references,
                timeline,
                sound_effects ? `音效：${sound_effects}` : '',
                music ? `配乐：${music}` : '',
            ].filter(Boolean).join('\n');

            const ratio = aspect_ratio || '16:9';
            const duration = duration_seconds || 5;

            // 构建 files 对象列表（模拟 koa-body 的 file 格式）
            const files = reference_images.map((ref: { image_path: string }) => {
                const absPath = path.join(parentpath, ref.image_path);
                return {
                    filepath: absPath,
                    originalFilename: path.basename(ref.image_path),
                    mimetype: mime.getType(absPath) || 'image/jpeg',
                };
            });

            // 校验参考图片文件存在
            for (const f of files) {
                if (!await fs.pathExists(f.filepath)) {
                    throw new Error(`参考图片不存在: ${f.filepath}`);
                }
            }

            // 生成视频名（自动去重）
            const video_name = generateVideoName(episode, video_number, title);

            // 完整保存路径：parentpath + save_path + video_name
            const full_save_path = path.join(parentpath, save_path, video_name);

            // 提交任务（非阻塞）
            let historyId: string;
            const seedance = isSeedanceModel(model);
            const seedanceDuration = duration === 5 ? 4 : duration;
            const seedanceRatio = ratio === '1:1' ? '4:3' : ratio;

            if (seedance) {
                historyId = await submitSeedanceVideoTask(
                    model, prompt,
                    { ratio: seedanceRatio, resolution, duration: seedanceDuration, files },
                    token
                );
            } else {
                historyId = await submitVideoTask(
                    model, prompt,
                    { ratio, resolution, duration, files },
                    token
                );
            }

            // 写入数据库
            const task = insertTask({
                video_name,
                save_path: full_save_path,
                history_id: historyId,
                refresh_token: token,
            });

            return {
                task_id: task.task_id,
                video_name: task.video_name,
                status: task.status,
            };
        },

    }

}
