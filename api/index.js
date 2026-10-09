// Vercel Serverless Function 入口
// 把所有 /api/* 请求转发到 Express app
import { app } from '../backend/server.js'

// Vercel Node Function 标准导出
export default app
