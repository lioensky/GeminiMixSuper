import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { createRequire } from 'module';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import iconv from 'iconv-lite';
const require = createRequire(import.meta.url);
const cheerio = require('cheerio');
const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');

dotenv.config();

const app = express();
app.use(express.json({ limit: '20mb' }));

const PROXY_URL = process.env.PROXY_URL;
const PROXY_PORT = Number(process.env.PROXY_PORT);

const DEEPSEEK_R1_API_KEY = process.env.DEEPSEEK_R1_API_KEY;
const DEEPSEEK_R1_MODEL = process.env.DEEPSEEK_R1_MODEL;
const DEEPSEEK_R1_MAX_TOKENS = Number(process.env.DEEPSEEK_R1_MAX_TOKENS);
const DEEPSEEK_R1_CONTEXT_WINDOW = Number(process.env.DEEPSEEK_R1_CONTEXT_WINDOW);
const DEEPSEEK_R1_TEMPERATURE = Number(process.env.DEEPSEEK_R1_TEMPERATURE);

const Model_output_API_KEY = process.env.Model_output_API_KEY;
const Model_output_MODEL = process.env.Model_output_MODEL;
const Model_output_MAX_TOKENS = Number(process.env.Model_output_MAX_TOKENS);
const Model_output_CONTEXT_WINDOW = Number(process.env.Model_output_CONTEXT_WINDOW);
const Model_output_TEMPERATURE = Number(process.env.Model_output_TEMPERATURE);
const Model_output_WebSearch = process.env.Model_output_WebSearch === 'True';

const RELAY_PROMPT = process.env.RELAY_PROMPT;
const HYBRID_MODEL_NAME = process.env.HYBRID_MODEL_NAME || 'GeminiMIXR1';
const OUTPUT_API_KEY = process.env.OUTPUT_API_KEY;

const Image_Model_API_KEY = process.env.Image_Model_API_KEY;
const Image_MODEL = process.env.Image_MODEL;
const Image_Model_MAX_TOKENS = Number(process.env.Image_Model_MAX_TOKENS);
const Image_Model_CONTEXT_WINDOW = Number(process.env.Image_Model_CONTEXT_WINDOW);
const Image_Model_TEMPERATURE = Number(process.env.Image_Model_TEMPERATURE);
const Image_Model_PROMPT = process.env.Image_Model_PROMPT;
const Image_SendR1_PROMPT = process.env.Image_SendR1_PROMPT;

// 添加新的环境变量
const GoogleSearch_API_KEY = process.env.GoogleSearch_API_KEY;
const GoogleSearch_MODEL = process.env.GoogleSearch_MODEL;
const GoogleSearch_Model_MAX_TOKENS = Number(process.env.GoogleSearch_Model_MAX_TOKENS);
const GoogleSearch_Model_CONTEXT_WINDOW = Number(process.env.GoogleSearch_Model_CONTEXT_WINDOW);
const GoogleSearch_Model_TEMPERATURE = Number(process.env.GoogleSearch_Model_TEMPERATURE);
const GoogleSearch_Determine_PROMPT = process.env.GoogleSearch_Determine_PROMPT;
const GoogleSearch_PROMPT = process.env.GoogleSearch_PROMPT;
const GoogleSearch_Send_PROMPT = process.env.GoogleSearch_Send_PROMPT;

// 用于存储当前任务的信息
let currentTask = null;

// 添加URL内容缓存
const urlContentCache = new Map();

// 添加一个用于存储所有活动请求的数组
let activeRequests = [];

// 修改控制台输出编码处理部分
if (process.platform === 'win32') {
    try {
        process.stdout.setEncoding('utf8');
        process.stderr.setEncoding('utf8');
    } catch (e) {
        console.error('设置控制台编码失败:', e);
    }
}

// 简化随机请求头生成函数
function generateRandomHeaders() {
    const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36`;
    
    return {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
    };
}

// 添加URL内容解析函数
async function parseUrlContent(url) {
    console.log('parseUrlContent 函数被调用了！');
    
    // 检查缓存
    if (urlContentCache.has(url)) {
        console.log('使用缓存的URL内容:', url);
        return urlContentCache.get(url);
    }

    console.log('开始解析URL内容:', url);
    
    // 定义请求配置，使用随机请求头
    const baseConfig = {
        timeout: Number(process.env.REQUEST_TIMEOUT),
        maxRedirects: Number(process.env.REQUEST_MAX_REDIRECTS),
        headers: generateRandomHeaders(),
        validateStatus: status => status < 400
    };

    // 定义重试次数和延迟
    const maxRetries = Number(process.env.PROXY_RETRY_ATTEMPTS);
    const retryDelay = Number(process.env.PROXY_RETRY_DELAY);
    
    let lastError = null;

    // 重试循环
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const config = { ...baseConfig };
            
            // 第一次尝试不使用代理，之后使用代理
            if (attempt > 0) {
                const proxyUrl = process.env.PROXY_URL_PARSE;
                config.httpsAgent = new HttpsProxyAgent(proxyUrl);
                console.log(`尝试第 ${attempt} 次，使用代理: ${proxyUrl}`);
            } else {
                console.log('第一次尝试，不使用代理');
            }

            const response = await axios.get(url, config);
            
            // 使用 cheerio 解析内容
            const $ = cheerio.load(response.data);
            
            // 移除干扰元素
            $('script, style, iframe, video, [class*="banner"], [class*="advert"], [class*="ads"]').remove();

            // 提取标题和主要内容
            const title = $('h1').first().text().trim() || 
                         $('[class*="title"]').first().text().trim() || 
                         $('title').text().trim();

            // 查找主要内容
            const contentSelectors = [
                'article', '[class*="article"]', '[class*="content"]',
                'main', '#main', '.text', '.body'
            ];

            let mainContent = '';
            for (const selector of contentSelectors) {
                const $content = $(selector);
                if ($content.length > 0) {
                    const paragraphs = [];
                    $content.find('p, h2, h3, h4, li').each((_, el) => {
                        const text = $(el).text().trim();
                        if (text && text.length > 20) {
                            paragraphs.push(text);
                        }
                    });
                    if (paragraphs.length > 0) {
                        mainContent = paragraphs.join('\n\n');
                        break;
                    }
                }
            }

            // 如果没找到主要内容，尝试全文提取
            if (!mainContent) {
                const paragraphs = [];
                $('body').find('p, h2, h3, h4, li').each((_, el) => {
                    const text = $(el).text().trim();
                    if (text && text.length > 20) {
                        paragraphs.push(text);
                    }
                });
                mainContent = paragraphs.join('\n\n');
            }

            // 格式化内容
            let content = mainContent
                .replace(/\s+/g, ' ')
                .replace(/\n\s*\n/g, '\n\n')
                .trim();

            // 验证内容质量
            if (!content || content.length < 50) {
                throw new Error('未能提取到有效内容');
            }

            // 添加标题和格式化
            const formattedContent = `标题：${title}\n\n正文：\n${content}`;
            
            // 存入缓存
            urlContentCache.set(url, formattedContent);
            
            console.log(`成功解析URL内容，长度: ${content.length}`);
            return formattedContent;

        } catch (error) {
            lastError = error;
            console.error(`第 ${attempt + 1} 次尝试失败:`, error.message);
            
            if (attempt < maxRetries) {
                // 等待一段时间后重试
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }

    // 所有尝试都失败后
    console.error('所有尝试都失败了:', lastError);
    return `[无法获取 ${url} 的内容: ${lastError.message}]`;
}

// API 密钥验证中间件
const apiKeyAuth = (req, res, next) => {
    const apiKey = req.headers.authorization;

    if (!apiKey || apiKey !== `Bearer ${OUTPUT_API_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
    }
    next();
};

// 合并 sanitizeLogContent 和 sanitizeContent 为一个函数
function sanitizeContent(content) {
    if (Array.isArray(content)) {
        return content.map(item => {
            if (item.type === 'image_url' && item.image_url?.url) {
                return {
                    ...item,
                    image_url: {
                        ...item.image_url,
                        url: item.image_url.url.substring(0, 20) + '...[base64]...'
                    }
                };
            }
            return item;
        });
    }
    return content;
}

// 简化的取消任务函数
function cancelCurrentTask() {
    if (!currentTask) {
        return;
    }

    console.log('收到新请求，取消当前任务...');
    
    try {
        // 1. 取消所有进行中的 API 请求
        activeRequests.forEach(request => {
            if (request.cancelTokenSource) {
                request.cancelTokenSource.cancel('收到新请求');
                console.log(`已取消 ${request.modelType} 的请求`);
            }
        });
        
        // 2. 结束当前响应流
        if (currentTask.res && !currentTask.res.writableEnded) {
            currentTask.res.write('data: {"choices": [{"delta": {"content": "\n\n[收到新请求，开始重新生成]"}, "index": 0, "finish_reason": "stop"}]}\n\n');
            currentTask.res.write('data: [DONE]\n\n');
            currentTask.res.end();
        }

        // 3. 确保取消当前任务的 cancelToken
        if (currentTask.cancelTokenSource) {
            currentTask.cancelTokenSource.cancel('收到新请求');
        }
        
        // 4. 清理资源
        activeRequests = [];
        currentTask = null;

    } catch (error) {
        console.error('取消任务时出错:', error);
        activeRequests = [];
        currentTask = null;
    }
}

// 添加一个队列处理 URL 的函数
async function processUrlQueue(urls) {
    console.log('开始处理 URL 队列:', urls);
    const results = [];
    
    for (const url of urls) {
        try {
            console.log(`正在处理队列中的 URL: ${url}`);
            const content = await parseUrlContent(url);
            results.push(content);
            // 在每个请求之间添加小延迟，避免过快请求
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            console.error(`处理 URL 失败: ${url}`, error);
            results.push(`[无法解析 ${url}]`);
        }
    }
    
    return results;
}

// 修改 preprocessMessages 函数，添加消息清理功能
async function preprocessMessages(messages) {
    console.log('开始预处理消息...');
    let processedMessages = [...messages];
    let allUrls = new Set();
    
    // 修改图片数据的处理方式，保留图片数据
    processedMessages = processedMessages.map(message => {
        if (Array.isArray(message.content)) {
            // 保留图片数据，只处理文本内容
            return {
                ...message,
                content: message.content.map(item => {
                    if (item.type === 'text') {
                        return item;
                    } else if (item.type === 'image_url') {
                        // 保持图片数据不变
                        return item;
                    }
                    return item;
                })
            };
        }
        return message;
    });

    // 遍历所有消息
    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        let textContent = '';
        
        // 处理不同格式的消息内容
        if (typeof message.content === 'string') {
            textContent = message.content;
        } else if (Array.isArray(message.content)) {
            // 处理多模态消息数组
            textContent = message.content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join('\n');
        }
        
        if (textContent) {
            // 简化的 URL 正则表达式
            const urlRegex = /https?:\/\/[^\s)]+/g;
            const matches = textContent.match(urlRegex) || [];
            
            // 验证并添加 URL
            matches.forEach(url => {
                try {
                    const validUrl = new URL(url.trim());
                    allUrls.add(validUrl.href);
                } catch (e) {
                    console.log(`跳过无效 URL: ${url}`);
                }
            });
        }
    }

    // 转换为数组并检查缓存
    const urlsToProcess = [...allUrls].filter(url => !urlContentCache.has(url));
    
    if (urlsToProcess.length > 0) {
        console.log(`找到 ${urlsToProcess.length} 个新的 URL 需要处理:`, urlsToProcess);
        
        try {
            // 使用队列处理新的 URL
            const newUrlContents = await processUrlQueue(urlsToProcess);
            
            // 更新缓存
            urlsToProcess.forEach((url, index) => {
                urlContentCache.set(url, newUrlContents[index]);
            });
        } catch (error) {
            console.error('URL 队列处理失败:', error);
        }
    }

    // 修改消息处理部分
    processedMessages = processedMessages.map(message => {
        let textContent = '';
        let originalContent = message.content;
        
        // 处理不同格式的消息内容
        if (typeof originalContent === 'string') {
            textContent = originalContent;
        } else if (Array.isArray(originalContent)) {
            // 只处理文本类型的内容
            const textItems = originalContent.filter(item => item.type === 'text');
            textContent = textItems.map(item => item.text).join('\n');
        }
        
        if (textContent) {
            const urlRegex = /https?:\/\/[^\s)]+/g;
            const matches = textContent.match(urlRegex) || [];
            
            if (matches.length > 0) {
                const messageUrlContents = matches
                    .map(url => {
                        try {
                            const validUrl = new URL(url.trim());
                            return {
                                url: validUrl.href,
                                content: urlContentCache.get(validUrl.href)
                            };
                        } catch (e) {
                            return null;
                        }
                    })
                    .filter(item => item && item.content)
                    .map(item => `\n--- ${item.url} 的内容 ---\n${item.content}`)
                    .join('\n\n');

                if (messageUrlContents) {
                    // 处理数组格式的消息内容
                    if (Array.isArray(originalContent)) {
                        return {
                            ...message,
                            content: [
                                ...originalContent.filter(item => item.type !== 'text'),
                                {
                                    type: 'text',
                                    text: textContent + '\n\n解析的网页内容：' + messageUrlContents
                                }
                            ]
                        };
                    } else {
                        // 处理字符串格式的消息内容
                        return {
                            ...message,
                            content: `${textContent}\n\n解析的网页内容：${messageUrlContents}`
                        };
                    }
                }
            }
        }
        return message;
    });
    
    return processedMessages;
}

// 修改主请求处理函数
app.post('/v1/chat/completions', apiKeyAuth, async (req, res) => {
    // 确保取消之前的任务
    if (currentTask) {
        console.log('存在正在进行的任务，准备取消...');
        cancelCurrentTask();
        // 等待一小段时间确保清理完成
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('开始处理新请求...');
    
    // 创建新任务
    const cancelTokenSource = axios.CancelToken.source();
    currentTask = { 
        res,
        cancelTokenSource
    };

    try {
        const originalRequest = req.body;
        let messages = [...originalRequest.messages];
        
        // 检查新图片并处理
        let image_index_content = null;
        if (hasNewImages(messages)) {
            console.log('发现新图片，开始处理');
            const images = extractLastImages(messages);
            const imageDescriptions = await Promise.all(
                images.map(img => processImage(img))
            );
            image_index_content = imageDescriptions.join('\n');
        }

        // 预处理消息（解析URL等，同时清理图片数据）
        messages = await preprocessMessages(messages);
        
        // 检查模型
        const requestedModel = originalRequest.model;
        if (requestedModel !== HYBRID_MODEL_NAME) {
            throw new Error(`Model not supported: ${requestedModel}`);
        }

        try {
            // 预处理阶段
            let searchResults = null;

            // 判断是否需要联网搜索（使用处理过的消息）
            const searchTask = determineIfSearchNeeded(messages).then(async needSearch => {
                if (needSearch) {
                    console.log('需要联网搜索，开始执行搜索');
                    searchResults = await performWebSearch(messages);
                }
            });

            // 等待所有预处理任务完成
            await Promise.all([searchTask]);

            // 在发送给 R1 之前过滤掉图片数据
            let messagesForR1 = [...messages];
            messagesForR1 = messagesForR1.map(message => {
                if (Array.isArray(message.content)) {
                    // 只保留文本内容
                    const textContents = message.content
                        .filter(item => item.type === 'text')
                        .map(item => item.text);
                    return {
                        ...message,
                        content: textContents.join('\n')
                    };
                }
                return message;
            });

            // 准备发送给 R1 的消息
            messagesForR1 = [
                ...messagesForR1,  // 使用过滤后的消息
                ...(searchResults ? [{
                    role: 'system',
                    content: `${process.env.GoogleSearch_Send_PROMPT}${searchResults}`
                }] : []),
                ...(image_index_content ? [{
                    role: 'system',
                    content: `${process.env.Image_SendR1_PROMPT}${image_index_content}`
                }] : []),
                { 
                    role: "system", 
                    content: process.env.Think_Lora_PROMPT 
                }
            ];

            // R1 请求使用过滤后的消息
            const r1CancelToken = axios.CancelToken.source();
            activeRequests.push({ 
                modelType: 'R1', 
                cancelTokenSource: r1CancelToken 
            });

            const deepseekResponse = await axios.post(
                `${PROXY_URL}/v1/chat/completions`,
                {
                    model: DEEPSEEK_R1_MODEL,
                    messages: messagesForR1,  // 使用过滤后的消息
                    max_tokens: DEEPSEEK_R1_MAX_TOKENS,
                    temperature: DEEPSEEK_R1_TEMPERATURE,
                    stream: true,
                },
                {
                    headers: {
                        Authorization: `Bearer ${DEEPSEEK_R1_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'stream',
                    cancelToken: r1CancelToken.token,
                    timeout: 30000,
                    'axios-retry': {
                        retries: 3,
                        retryDelay: (retryCount) => retryCount * 1000,
                        retryCondition: (error) => {
                            return (
                                axios.isNetworkError(error) ||
                                error.code === 'ECONNABORTED' ||
                                error.response?.status === 429 ||
                                error.response?.status >= 500
                            );
                        }
                    }
                }
            ).catch(async error => {
                console.error('R1 请求失败:', error.message);
                
                // 如果响应已经发送或结束，直接返回
                if (res.headersSent || res.writableEnded) {
                    throw error;
                }

                // 切换到 Gemini
                console.log('切换到 Gemini 模型');
                const geminiCancelToken = axios.CancelToken.source();
                
                // 在准备 Gemini 消息时使用原始消息（包含图片）
                const geminiMessages = [
                    ...messages,  // 使用原始消息，保留图片数据
                    ...(searchResults ? [{
                        role: 'system',
                        content: `${process.env.GoogleSearch_Send_PROMPT}${searchResults}`
                    }] : []),
                    { 
                        role: 'system', 
                        content: '由于前置思考系统暂时无法使用，请直接进行回复。请注意，你可以看到所有的搜索结果和图片内容。' 
                    }
                ];

                try {
                    // 直接返回，不继续执行后面的 deepseekResponse.data 相关代码
                    return await callGemini(geminiMessages, res, geminiCancelToken, originalRequest);
                } catch (geminiError) {
                    console.error('Gemini 也失败了:', geminiError);
                    if (!res.headersSent && !res.writableEnded) {
                        res.status(503).json({
                            error: 'Service unavailable',
                            message: '服务暂时不可用，请稍后重试'
                        });
                    }
                    throw geminiError;
                }
            });

            // 只有在 R1 请求成功时才执行这部分代码
            if (deepseekResponse) {
                let thinkingContent = '';
                let receivedThinkingEnd = false;
                let choiceIndex = 0;
                let geminiResponseSent = false;
                let thinkTagSent = false;

                deepseekResponse.data.on('data', (chunk) => {
                    setTimeout(() => {
                        const chunkStr = chunk.toString();
                        
                        // 修改日志输出方式
                        try {
                            if (chunkStr.trim() === 'data: [DONE]') {
                                return;
                            }
                            const deepseekData = JSON.parse(chunkStr.replace(/^data: /, ''));
                            
                            // 只输出实际的内容变化
                            const reasoningContent = deepseekData.choices[0]?.delta?.reasoning_content;
                            if (reasoningContent) {
                                process.stdout.write(reasoningContent); // 使用 process.stdout.write 实现流式输出
                            }

                            // 构造 OpenAI 格式的 SSE 消息
                            const formattedData = {
                                id: deepseekData.id,
                                object: 'chat.completion.chunk',
                                created: deepseekData.created,
                                model: HYBRID_MODEL_NAME,
                                choices: deepseekData.choices.map((choice, index) => {
                                    let deltaContent = choice.delta.reasoning_content;
                                    if (!deltaContent) {
                                        deltaContent = "";
                                    }
                                    return {
                                        delta: {
                                            content: deltaContent,
                                        },
                                        index: index,
                                        finish_reason: choice.finish_reason,
                                    };
                                }),
                            };

                            if (formattedData.choices[0].delta.content) { // 仅当 delta 中有内容时才发送
                                if (!geminiResponseSent && !thinkTagSent) { // 检查 Gemini 响应是否已发送和 thinkTagSent 标志位
                                    formattedData.choices[0].delta.content = "<think>AiModel辅助思考系统已载入。" + formattedData.choices[0].delta.content; // 添加 <think> 标签
                                    thinkTagSent = true; // 设置 thinkTagSent 为 true
                                }
                                res.write(`data: ${JSON.stringify(formattedData)}\n\n`);
                            }

                            if (!receivedThinkingEnd) {
                                const reasoningContent = deepseekData.choices[0]?.delta?.reasoning_content || '';
                                thinkingContent += reasoningContent;
                                
                                // 只在 reasoning_content 结束时输出一次完整的思考内容
                                if (!reasoningContent && thinkingContent !== '') {
                                    console.log('\n\nR1 思考完成，完整内容：\n', thinkingContent, '\n');
                                    receivedThinkingEnd = true;
                                    
                                    // 1. 首先取消 R1 的生成请求
                                    try {
                                        // 使用 axios 的 CancelToken 来取消请求
                                        r1CancelToken.cancel('Reasoning content finished');
                                        console.log('已发送取消请求给 R1 服务器');
                                    } catch (cancelError) {
                                        console.error('取消 R1 请求时出错:', cancelError);
                                    }
                                    
                                    // 2. 然后关闭数据流
                                    deepseekResponse.data.destroy();
                                    
                                    // 3. 为 Gemini 创建新的 cancelToken
                                    const geminiCancelToken = axios.CancelToken.source();
                                    
                                    // 4. 继续后续的 Gemini 调用
                                    const geminiMessages = [
                                        ...messages,
                                        ...(searchResults ? [{
                                            role: 'system',
                                            content: `${process.env.GoogleSearch_Send_PROMPT}${searchResults}`
                                        }] : []),
                                        { 
                                            role: 'assistant', 
                                            content: thinkingContent 
                                        },
                                        { 
                                            role: 'user', 
                                            content: RELAY_PROMPT 
                                        }
                                    ];

                                    // 在 Gemini 请求发起时添加到活动请求列表
                                    activeRequests.push({ 
                                        modelType: 'Gemini', 
                                        cancelTokenSource: geminiCancelToken 
                                    });

                                    axios.post(
                                        `${process.env.PROXY_URL2}/v1/chat/completions`,
                                        {
                                            model: Model_output_MODEL,
                                            messages: geminiMessages,
                                            max_tokens: Model_output_MAX_TOKENS,
                                            temperature: Model_output_TEMPERATURE,
                                            stream: true,
                                        },
                                        {
                                            headers: {
                                                Authorization: `Bearer ${Model_output_API_KEY}`,
                                                'Content-Type': 'application/json',
                                            },
                                            responseType: 'stream',
                                            cancelToken: geminiCancelToken.token,
                                            timeout: 30000,
                                            'axios-retry': {
                                                retries: 3,
                                                retryDelay: (retryCount) => retryCount * 1000,
                                                retryCondition: (error) => {
                                                    return (
                                                        axios.isNetworkError(error) ||
                                                        error.code === 'ECONNABORTED' ||
                                                        error.response?.status === 429 ||
                                                        error.response?.status >= 500
                                                    );
                                                }
                                            },
                                        }
                                    ).then(geminiResponse => {
                                        console.log('Gemini 模型开始输出');
                                        geminiResponseSent = true;
                                        res.write('data: {"choices": [{"delta": {"content": "\\n辅助思考已结束，以上辅助思考内容用户不可见，请MODEL开始以中文作为主要语言进行正式输出</think>"}, "index": 0, "finish_reason": null}]}\n\n'); // 输出 </think> 标签
                                        geminiResponse.data.on('data', chunk => {
                                            try {
                                                const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                                                for (const line of lines) {
                                                    if (line.startsWith('data: ')) {
                                                        // 检查是否是 [DONE] 信号
                                                        if (line.includes('[DONE]')) {
                                                            continue;
                                                        }
                                                        
                                                        try {
                                                            const data = JSON.parse(line.slice(6));
                                                            const content = data.choices[0]?.delta?.content || '';
                                                            if (content) {
                                                                const formattedChunk = {
                                                                    id: `chatcmpl-${Date.now()}`,
                                                                    object: 'chat.completion.chunk',
                                                                    created: Math.floor(Date.now() / 1000),
                                                                    model: HYBRID_MODEL_NAME,
                                                                    choices: [{
                                                                        delta: { content },
                                                                        index: choiceIndex++,
                                                                        finish_reason: null
                                                                    }]
                                                                };
                                                                res.write(`data: ${JSON.stringify(formattedChunk)}\n\n`);
                                                            }
                                                        } catch (parseError) {
                                                            // 忽略 [DONE] 和其他非 JSON 数据的解析错误
                                                            if (!line.includes('[DONE]')) {
                                                                console.error('Error parsing chunk data:', parseError);
                                                            }
                                                        }
                                                    }
                                                }
                                            } catch (error) {
                                                console.error('Error processing chunk:', error);
                                            }
                                        });

                                        // 修改结束处理
                                        geminiResponse.data.on('end', () => {
                                            console.log('\n\nGemini response ended.'); // 添加换行使输出更清晰
                                            res.write('data: [DONE]\n\n');
                                            if (!res.writableEnded) {
                                                res.end();
                                            }
                                            currentTask = null;
                                            removeActiveRequest('Gemini');
                                        });

                                        geminiResponse.data.on('error', (error) => {
                                            console.error('Gemini 模型调用失败');
                                            if (!res.writableEnded) {
                                                res.end();
                                            }
                                            currentTask = null;
                                            removeActiveRequest('Gemini');
                                        });
                                    }).catch(error => {
                                        console.error('Gemini 模型调用失败');
                                        console.error('Gemini 请求重试失败，返回 503 错误');
                                        
                                        if (!res.writableEnded) {
                                            let errorMessage = 'Error calling Gemini API';
                                            if (error.code === 'ECONNABORTED') {
                                                errorMessage = 'Gemini 请求超时';
                                                res.status(504).send({ error: errorMessage });
                                            } else if (error.response?.status === 429) {
                                                errorMessage = 'Gemini 请求频率超限';
                                                res.status(429).send({ error: errorMessage });
                                            } else if (error.config?.__retryCount >= 3) {
                                                errorMessage = 'Gemini 多次重试后失败';
                                                console.log('Gemini 请求重试失败，返回 503 错误');
                                                res.status(503).send({ error: errorMessage });
                                            }
                                            else {
                                                res.status(error.response?.status || 500).send({ error: errorMessage });
                                            }
                                            res.end();
                                        }
                                        currentTask = null;
                                        removeActiveRequest('Gemini');
                                    });
                                }
                            }
                        } catch (error) {
                            console.error('Error parsing Deepseek R1 chunk:', error);
                        }
                    }, 600);
                });

                deepseekResponse.data.on('end', () => {
                    console.log('Deepseek response ended. receivedThinkingEnd:', receivedThinkingEnd);
                    removeActiveRequest('R1');
                    if (!geminiResponseSent && !res.writableEnded) {
                        res.write('data: [DONE]\n\n');
                        res.end();
                    }
                    currentTask = null;
                });

                deepseekResponse.data.on('error', async (error) => {
                    // 如果是取消请求导致的错误，只输出简单日志
                    if (axios.isCancel(error)) {
                        console.log('R1 请求已取消:', error.message);
                        return;
                    }

                    // 其他错误继续原有的处理逻辑
                    console.error('Deepseek R1 请求出错:', error);
                    
                    if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
                        if (!geminiResponseSent && !res.headersSent && !res.writableEnded) {
                            // 为 Gemini 创建新的 cancelToken
                            const geminiCancelToken = axios.CancelToken.source();
                            
                            const geminiMessages = [
                                ...messages,
                                ...(searchResults ? [{
                                    role: 'system',
                                    content: `${process.env.GoogleSearch_Send_PROMPT}${searchResults}`
                                }] : []),
                                { 
                                    role: 'system', 
                                    content: '由于前置思考系统连接中断，请直接进行回复。请注意，你可以看到所有的搜索结果和图片内容。' 
                                }
                            ];

                            try {
                                await callGemini(geminiMessages, res, geminiCancelToken, originalRequest);
                            } catch (geminiError) {
                                console.error('Both R1 and Gemini failed:', geminiError);
                                if (!res.headersSent && !res.writableEnded) {
                                    res.status(500).json({
                                        error: 'Connection interrupted',
                                        message: '网络连接中断，请重新发送请求'
                                    });
                                }
                            }
                        }
                        
                        if (currentTask) {
                            currentTask.cancelTokenSource.cancel('Connection interrupted');
                            currentTask = null;
                        }
                        
                        return;
                    }
                });
            }
        } catch (error) {
            console.error('请求处理错误:', error);
            if (!res.headersSent && !res.writableEnded) {
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
            currentTask = null;
        }
    } catch (error) {
        console.error('请求处理错误:', error);
        if (!res.headersSent && !res.writableEnded) {
            res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
        currentTask = null;
    }
});

// 修改 callGemini 函数
function callGemini(messages, res, cancelTokenSource, originalRequest) {
    return new Promise((resolve, reject) => {
        let choiceIndex = 0;
        
        const makeRequest = async () => {
            try {
                // 保持原始消息格式，包括图片数据
                const requestConfig = {
                    model: Model_output_MODEL,
                    messages: messages,  // 直接使用原始消息，不做过滤
                    max_tokens: Model_output_MAX_TOKENS,
                    temperature: Model_output_TEMPERATURE,
                    stream: true,
                };

                // 如果启用了 WebSearch，添加 function calling 配置
                if (Model_output_WebSearch) {
                    requestConfig.tools = [{
                        type: "function",
                        function: {
                            name: "googleSearch",
                            description: "Search the web for relevant information",
                            parameters: {
                                type: "object",
                                properties: {
                                    query: {
                                        type: "string",
                                        description: "The search query"
                                    }
                                },
                                required: ["query"]
                            }
                        }
                    }];
                }

                const geminiResponse = await axios.post(
                    `${process.env.PROXY_URL2}/v1/chat/completions`,
                    requestConfig,
                    {
                        headers: {
                            Authorization: `Bearer ${Model_output_API_KEY}`,
                            'Content-Type': 'application/json',
                        },
                        responseType: 'stream',
                        cancelToken: cancelTokenSource.token,
                        timeout: 30000,
                        'axios-retry': {
                            retries: 3,
                            retryDelay: (retryCount) => retryCount * 1000,
                            retryCondition: (error) => {
                                return (
                                    axios.isNetworkError(error) ||
                                    error.code === 'ECONNABORTED' ||
                                    error.response?.status === 429 ||
                                    error.response?.status >= 500
                                );
                            }
                        }
                    }
                );

                console.log('Gemini 请求成功');

                // 处理响应流
                geminiResponse.data.on('data', chunk => {
                    try {
                        // 再次检查响应状态
                        if (res.writableEnded) {
                            console.log('响应已结束，停止处理数据');
                            return;
                        }

                        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                if (line.includes('[DONE]')) continue;
                                
                                const data = JSON.parse(line.slice(6));
                                
                                // 处理 function calling 的响应
                                if (data.choices[0]?.delta?.tool_calls) {
                                    const toolCalls = data.choices[0].delta.tool_calls;
                                    console.log('收到 function calling 请求:', JSON.stringify(toolCalls));
                                    // 这里可以添加处理 function calling 的逻辑
                                    continue;
                                }
                                
                                const content = data.choices[0]?.delta?.content || '';
                                if (content) {
                                    const formattedChunk = {
                                        id: `chatcmpl-${Date.now()}`,
                                        object: 'chat.completion.chunk',
                                        created: Math.floor(Date.now() / 1000),
                                        model: HYBRID_MODEL_NAME,
                                        choices: [{
                                            delta: { content },
                                            index: choiceIndex++,
                                            finish_reason: null
                                        }]
                                    };
                                    res.write(`data: ${JSON.stringify(formattedChunk)}\n\n`);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('处理数据块时出错:', error);
                    }
                });

                geminiResponse.data.on('end', () => {
                    if (!res.writableEnded) {
                        res.write('data: [DONE]\n\n');
                        res.end();
                    }
                    resolve();
                });

                geminiResponse.data.on('error', error => {
                    console.error('Gemini 流错误:', error);
                    reject(error);
                });

            } catch (error) {
                console.error('Gemini 请求错误:', error);
                reject(error);
            }
        };

        makeRequest().catch(reject);
    });
}

// 处理图片识别的函数
async function processImage(imageMessage) {
    // 创建用于日志的安全版本
    const logSafeImageMessage = {
        ...imageMessage,
        image_url: imageMessage.image_url ? {
            ...imageMessage.image_url,
            url: imageMessage.image_url.url.substring(0, 20) + '...[base64]...'
        } : imageMessage.image_url
    };
    console.log('开始处理图片:', JSON.stringify(logSafeImageMessage, null, 2));
    
    try {
        const requestBody = {
            model: Image_MODEL,
            messages: [
                { role: "user", content: Image_Model_PROMPT },
                { role: "user", content: [imageMessage] }  // 保持原始数据用于实际请求
            ],
            max_tokens: Image_Model_MAX_TOKENS,
            temperature: Image_Model_TEMPERATURE,
            stream: false,
        };
        
        // 创建用于日志的安全版本
        const logSafeRequestBody = {
            ...requestBody,
            messages: requestBody.messages.map(msg => ({
                ...msg,
                content: Array.isArray(msg.content) 
                    ? msg.content.map(item => {
                        if (item.type === 'image_url' && item.image_url?.url) {
                            return {
                                ...item,
                                image_url: {
                                    ...item.image_url,
                                    url: item.image_url.url.substring(0, 20) + '...[base64]...'
                                }
                            };
                        }
                        return item;
                    })
                    : msg.content
            }))
        };
        
        console.log('发送给图像识别模型的请求:', JSON.stringify(logSafeRequestBody, null, 2));
        
        const response = await axios.post(
            `${process.env.PROXY_URL3}/v1/chat/completions`,
            requestBody,  // 使用原始数据发送请求
            {
                headers: {
                    Authorization: `Bearer ${Image_Model_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        
        console.log('图像识别模型响应:', JSON.stringify(response.data, null, 2));
        
        const content = response.data.choices[0].message.content;
        console.log('图片描述结果:', content);
        return content;
    } catch (error) {
        console.error('图片处理错误:', error);
        console.error('错误详情:', {
            message: error.message,
            response: error.response?.data,
            config: {
                ...error.config,
                data: error.config?.data ? JSON.parse(error.config.data).messages.map(msg => ({
                    ...msg,
                    content: Array.isArray(msg.content) 
                        ? msg.content.map(item => {
                            if (item.type === 'image_url' && item.image_url?.url) {
                                return {
                                    ...item,
                                    image_url: {
                                        ...item.image_url,
                                        url: item.image_url.url.substring(0, 20) + '...[base64]...'
                                    }
                                };
                            }
                            return item;
                        })
                        : msg.content
                })) : error.config?.data
            }
        });
        throw error;
    }
}

// 检查消息是否包含本轮新的图片
function hasNewImages(messages) {
    const logSafeMessages = messages.map(msg => ({
        ...msg,
        content: sanitizeContent(msg.content)
    }));
    console.log('检查新图片 - 完整消息:', JSON.stringify(logSafeMessages, null, 2));
    const lastMessage = messages[messages.length - 1];
    const hasImages = lastMessage && Array.isArray(lastMessage.content) && 
                     lastMessage.content.some(item => item.type === 'image_url');
    console.log('是否包含新图片:', hasImages); // 添加日志
    return hasImages;
}

// 提取最后一条消息中的图片
function extractLastImages(messages) {
    const lastMessage = messages[messages.length - 1];
    const logSafeMessage = {
        ...lastMessage,
        content: sanitizeContent(lastMessage.content)
    };
    console.log('提取图片 - 最后一条消息:', JSON.stringify(logSafeMessage, null, 2));
    if (!lastMessage || !Array.isArray(lastMessage.content)) {
        console.log('没有找到图片消息');
        return [];
    }
    const images = lastMessage.content.filter(item => item.type === 'image_url');
    // 创建用于日志的安全版本
    const logSafeImages = images.map(img => ({
        ...img,
        image_url: img.image_url ? {
            ...img.image_url,
            url: img.image_url.url.substring(0, 20) + '...[base64]...'
        } : img.image_url
    }));
    console.log('提取到的图片:', JSON.stringify(logSafeImages, null, 2));
    return images;
}

// 添加判断是否需要联网搜索的函数
async function determineIfSearchNeeded(messages) {
    console.log('开始判断是否需要联网搜索');
    try {
        const response = await axios.post(
            `${process.env.PROXY_URL4}/v1/chat/completions`,
            {
                model: process.env.SearchDetermine_MODEL, // 改用新的小模型
                messages: [
                    { role: "user", content: process.env.GoogleSearch_Determine_PROMPT },
                    ...messages
                ],
                max_tokens: Number(process.env.SearchDetermine_Model_MAX_TOKENS), // 使用对应的参数
                temperature: Number(process.env.SearchDetermine_Model_TEMPERATURE), // 使用对应的参数
                stream: false,
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.SearchDetermine_API_KEY}`, // 使用对应的API密钥
                    'Content-Type': 'application/json',
                }
            }
        );

        const decision = response.data.choices[0].message.content.trim().toLowerCase();
        console.log('联网判断结果:', decision);
        return decision === 'yes';
    } catch (error) {
        console.error('联网判断出错:', error);
        return false;
    }
}

// 修改执行联网搜索的函数
async function performWebSearch(messages) {
    console.log('开始执行联网搜索');
    try {
        // 第一步：获取搜索关键词
        const searchTermsResponse = await axios.post(
            `${process.env.PROXY_URL4}/v1/chat/completions`,
            {
                model: GoogleSearch_MODEL,
                messages: [
                    { 
                        role: "user", 
                        content: "你是一个搜索关键词生成器。请根据对话内容，生成多个相关的搜索关键词。每行一个关键词。不要有任何解释或其他文字，不要回复搜索词以外的任何内容。同时生成中英文关键词以获得更全面的结果。" 
                    },
                    ...messages
                ],
                max_tokens: GoogleSearch_Model_MAX_TOKENS,
                temperature: GoogleSearch_Model_TEMPERATURE,
                stream: false
            },
            {
                headers: {
                    Authorization: `Bearer ${GoogleSearch_API_KEY}`,
                    'Content-Type': 'application/json',
                }
            }
        );

        const searchTerms = searchTermsResponse.data.choices[0].message.content;
        console.log('生成的搜索关键词:\n', searchTerms); // 简化日志输出

        // 第二步：执行实际的搜索
        const searchResponse = await axios.post(
            `${process.env.PROXY_URL4}/v1/chat/completions`,
            {
                model: GoogleSearch_MODEL,
                messages: [
                    { role: "user", content: "Please search the web for the following query and provide relevant information:" },
                    { role: "user", content: searchTerms }
                ],
                max_tokens: GoogleSearch_Model_MAX_TOKENS,
                temperature: GoogleSearch_Model_TEMPERATURE,
                stream: false,
                tools: [{
                    type: "function",
                    function: {
                        name: "googleSearch",
                        description: "Search the web for relevant information",
                        parameters: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "The search query"
                                }
                            },
                            required: ["query"]
                        }
                    }
                }],
                tool_choice: {
                    type: "function",
                    function: {
                        name: "googleSearch"
                    }
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${GoogleSearch_API_KEY}`,
                    'Content-Type': 'application/json',
                }
            }
        );

        const searchResults = searchResponse.data.choices[0].message.content;
        console.log('搜索结果:', searchResults);
        return searchResults;
    } catch (error) {
        console.error('搜索关键词生成失败'); // 简化错误日志
        return null;
    }
}

// 添加正确的 removeActiveRequest 函数
function removeActiveRequest(modelType) {
    activeRequests = activeRequests.filter(req => req.modelType !== modelType);
    console.log(`${modelType} 请求已完成，从活动请求列表中移除`);
}

// 修改文件解析函数中的 CSV 部分
async function parseFile(fileType, fileContent) {
    try {
        switch(fileType.toLowerCase()) {
            case 'application/pdf':
                try {
                    console.log('开始解析 PDF 文件，文件大小:', fileContent.length, '字节');
                    const pdfData = await pdfParse(Buffer.from(fileContent));
                    console.log('PDF 解析完成，提取的文本长度:', pdfData.text.length);
                    return pdfData.text;
                } catch (pdfError) {
                    console.error('PDF 解析错误:', pdfError);
                    throw new Error(`PDF 解析失败: ${pdfError.message}`);
                }
                
            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                const result = await mammoth.extractRawText({buffer: fileContent});
                return result.value;
                
            case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
            case 'application/vnd.ms-excel':
                // Excel 文件解析
                const workbook = XLSX.read(fileContent, {
                    type: 'buffer',
                    codepage: 936, // 设置编码为 GBK/GB2312
                    cellStyles: true,
                    cellDates: true,
                    cellNF: true,
                    cellText: true
                });
                
                let excelContent = [];
                
                // 遍历所有工作表
                workbook.SheetNames.forEach(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    // 使用 sheet_to_json 时添加配置
                    const sheetData = XLSX.utils.sheet_to_json(sheet, {
                        header: 1,
                        raw: false, // 获取格式化的值
                        dateNF: 'yyyy-mm-dd', // 日期格式
                        defval: '', // 空单元格的默认值
                    });
                    
                    if (sheetData.length > 0) {
                        excelContent.push(`\n工作表：${sheetName}`);
                        
                        // 处理表头
                        if (sheetData[0]) {
                            const headers = sheetData[0].map(header => 
                                header ? header.toString().trim() : ''
                            ).filter(Boolean);
                            if (headers.length > 0) {
                                excelContent.push(`表头：${headers.join(' | ')}`);
                            }
                        }
                        
                        // 处理数据行
                        sheetData.slice(1).forEach(row => {
                            if (row && row.some(cell => cell !== undefined && cell !== '')) {
                                const formattedRow = row.map(cell => {
                                    if (cell === undefined || cell === '') return '';
                                    // 处理数字、日期等特殊格式
                                    return cell.toString().trim();
                                });
                                if (formattedRow.some(cell => cell !== '')) {
                                    excelContent.push(formattedRow.join(' | '));
                                }
                            }
                        });
                    }
                });
                
                return excelContent.join('\n');
                
            case 'text/csv':
                console.log('开始解析 CSV 文件');
                
                // 直接使用 GBK 解码
                const decodedContent = iconv.decode(fileContent, 'gbk');
                console.log('文件解码完成，开始解析 CSV');

                try {
                    const records = parse(decodedContent, {
                        skip_empty_lines: true,
                        trim: true,
                        relaxQuotes: true,
                        relaxColumnCount: true
                    });

                    if (records.length === 0) {
                        return '文件为空';
                    }

                    // 处理表头
                    const headers = records[0]
                        .map(header => header.trim())
                        .filter(Boolean);
                    console.log('检测到的表头:', headers);

                    // 格式化输出
                    const formattedRecords = [];
                    formattedRecords.push('表头: ' + headers.join(' | '));

                    // 处理数据行
                    for (let i = 1; i < records.length; i++) {
                        const row = records[i];
                        if (row.every(cell => !cell)) continue; // 跳过空行

                        // 处理每个单元格，保持原始的列对应关系
                        const formattedCells = row.map((cell, index) => {
                            if (!cell) return null;
                            const header = headers[index] || `列${index + 1}`;
                            return `${header}: ${cell.trim()}`;
                        }).filter(Boolean);

                        if (formattedCells.length > 0) {
                            formattedRecords.push(formattedCells.join(' | '));
                        }
                    }

                    return formattedRecords.join('\n');

                } catch (error) {
                    console.error('CSV 解析错误:', error);
                    throw error;
                }
                
            default:
                throw new Error(`不支持的文件类型: ${fileType}`);
        }
    } catch (error) {
        console.error('文件解析错误:', error);
        throw error;
    }
}

app.listen(PROXY_PORT, () => {
    console.log(`Hybrid AI proxy server started on port ${PROXY_PORT}`);
});
