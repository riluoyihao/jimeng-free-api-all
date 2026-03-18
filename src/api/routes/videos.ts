import _ from 'lodash';

import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { tokenSplit } from '@/api/controllers/core.ts';
import { generateVideo, generateSeedanceVideo, isSeedanceModel, checkVideoStatus, DEFAULT_MODEL } from '@/api/controllers/videos.ts';
import util from '@/lib/util.ts';
import APIException from '@/lib/exceptions/APIException.ts';
import EX from '@/api/consts/exceptions.ts';

export default {

    prefix: '/v1/videos',

    get: {

        '/tasks/:taskId': async (request: Request) => {
            request.validate('headers.authorization', _.isString);
            const tokens = tokenSplit(request.headers.authorization);
            const token = _.sample(tokens);
            const { taskId } = request.params;
            return await checkVideoStatus(taskId, token);
        },

        '/download': async (request: Request) => {
            request.validate('headers.authorization', _.isString);
            const tokens = tokenSplit(request.headers.authorization);
            const token = _.sample(tokens);

            const { url, task_id } = request.query;
            if (!url && !task_id)
                throw new APIException(EX.API_REQUEST_PARAMS_INVALID, '需要提供 url 或 task_id 参数');

            let videoUrl = url;
            if (!videoUrl) {
                const statusResult = await checkVideoStatus(task_id, token);
                if (statusResult.status !== 'completed' || !statusResult.video_url)
                    return statusResult;
                videoUrl = statusResult.video_url;
            }

            const videoResponse = await fetch(videoUrl);
            if (!videoResponse.ok)
                throw new APIException(EX.API_REQUEST_FAILED, `下载视频失败: ${videoResponse.status}`);

            const contentType = videoResponse.headers.get('content-type') || 'video/mp4';
            const buffer = Buffer.from(await videoResponse.arrayBuffer());
            return new Response(buffer, {
                type: contentType,
                headers: {
                    'Content-Disposition': 'attachment; filename="video.mp4"',
                    'Content-Length': String(buffer.length),
                }
            });
        },

    },

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
                response_format = "url",
                async: asyncMode = false,
            } = request.body;

            // 如果是 multipart/form-data，需要将字符串转换为数字
            const finalDuration = isMultiPart && typeof duration === 'string'
                ? parseInt(duration)
                : duration;

            // 兼容两种参数名格式：file_paths 和 filePaths
            const finalFilePaths = filePaths.length > 0 ? filePaths : file_paths;

            const isAsync = asyncMode === true || asyncMode === 'true';

            // 根据模型类型选择不同的生成函数
            if (isSeedanceModel(model)) {
                // Seedance 2.0 多图智能视频生成
                // Seedance 默认时长为 4 秒，默认比例为 4:3
                const seedanceDuration = finalDuration === 5 ? 4 : finalDuration; // 如果是默认的5秒，转为4秒
                const seedanceRatio = ratio === "1:1" ? "4:3" : ratio; // 如果是默认的1:1，转为4:3

                const result = await generateSeedanceVideo(
                    model,
                    prompt,
                    {
                        ratio: seedanceRatio,
                        resolution,
                        duration: seedanceDuration,
                        filePaths: finalFilePaths,
                        files: request.files,
                        asyncMode: isAsync,
                    },
                    token
                );

                if (isAsync) {
                    return { task_id: result, status: 'pending', created: util.unixTimestamp() };
                }

                const videoUrl = result;
                if (response_format === "b64_json") {
                    const videoBase64 = await util.fetchFileBASE64(videoUrl);
                    return { created: util.unixTimestamp(), data: [{ b64_json: videoBase64, revised_prompt: prompt }] };
                }
                return { created: util.unixTimestamp(), data: [{ url: videoUrl, revised_prompt: prompt }] };

            } else {
                // 普通视频生成
                const result = await generateVideo(
                    model,
                    prompt,
                    {
                        ratio,
                        resolution,
                        duration: finalDuration,
                        filePaths: finalFilePaths,
                        files: request.files,
                        asyncMode: isAsync,
                    },
                    token
                );

                if (isAsync) {
                    return { task_id: result, status: 'pending', created: util.unixTimestamp() };
                }

                const videoUrl = result;
                if (response_format === "b64_json") {
                    const videoBase64 = await util.fetchFileBASE64(videoUrl);
                    return { created: util.unixTimestamp(), data: [{ b64_json: videoBase64, revised_prompt: prompt }] };
                }
                return { created: util.unixTimestamp(), data: [{ url: videoUrl, revised_prompt: prompt }] };
            }
        }

    }

}
