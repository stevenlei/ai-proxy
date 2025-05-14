import { Hono } from "hono"
import { cors } from "hono/cors"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { logger } from "hono/logger"
import { proxy } from 'hono/proxy'
import 'dotenv/config'


const app = new Hono()

// Get API key from .env
const API_KEY = process.env.API_KEY

if (!API_KEY) {
  console.error('API_KEY is not defined in .env file')
  process.exit(1)
}

app.use(cors())

app.use(logger())

app.use(async (c, next) => {
  await next()
  c.res.headers.set("X-Accel-Buffering", "no")
})

// Root path handler
app.get("/", (c) => c.text("A proxy for AI! Use /{api_key}/{provider} to access the API."))

// API key validation middleware
app.use('/:apiKey/*', async (c, next) => {
  const apiKey = c.req.param('apiKey')
  
  if (apiKey !== API_KEY) {
    return c.text('Unauthorized: Invalid API key', 401)
  }
  
  await next()
})

const fetchWithTimeout = async (
  url: string,
  { timeout, ...options }: RequestInit & { timeout: number },
) => {
  const controller = new AbortController()

  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeout)

  try {
    const res = await proxy(url, {
      ...options,
      signal: controller.signal,
      // @ts-expect-error
      duplex: "half",
    })
    clearTimeout(timeoutId)
    return res
  } catch (error) {
    clearTimeout(timeoutId)
    if (controller.signal.aborted) {
      return new Response("Request timeout", {
        status: 504,
      })
    }

    throw error
  }
}

const proxies: { pathSegment: string; target: string; orHostname?: string }[] =
  [
    {
      pathSegment: "generativelanguage",
      orHostname: "gooai.chatkit.app",
      target: "https://generativelanguage.googleapis.com",
    },
    {
      pathSegment: "groq",
      target: "https://api.groq.com",
    },
    {
      pathSegment: "anthropic",
      target: "https://api.anthropic.com",
    },
    {
      pathSegment: "pplx",
      target: "https://api.perplexity.ai",
    },
    {
      pathSegment: "openai",
      target: "https://api.openai.com",
    },
    {
      pathSegment: "mistral",
      target: "https://api.mistral.ai",
    },
    {
      pathSegment: "openrouter/api",
      target: "https://openrouter.ai/api",
    },
    {
      pathSegment: "openrouter",
      target: "https://openrouter.ai/api",
    },
    {
      pathSegment: "xai",
      target: "https://api.x.ai",
    },
  ]

app.post(
  "/:apiKey/custom-model-proxy",
  zValidator(
    "query",
    z.object({
      url: z.string().url(),
    }),
  ),
  async (c) => {
    const { url } = c.req.valid("query")

    const res = await proxy(url, {
      method: c.req.method,
      body: c.req.raw.body,
      headers: c.req.raw.headers,
    })

    return new Response(res.body, {
      headers: res.headers,
      status: res.status,
    })
  },
)

app.use(async (c, next) => {
  const url = new URL(c.req.url)
  const apiKey = url.pathname.split('/')[1] // This is already validated by the middleware

  // Extract the path without the API key segment
  const pathWithoutApiKey = '/' + url.pathname.split('/').slice(2).join('/')

  const proxy = proxies.find(
    (p) =>
      pathWithoutApiKey.startsWith(`/${p.pathSegment}/`) ||
      (p.orHostname && url.hostname === p.orHostname),
  )

  if (proxy) {
    const headers = new Headers(c.req.raw.headers)
    if (proxy.pathSegment === "anthropic") {
      headers.delete("origin")
    }
    headers.delete('content-length')
    headers.delete('host')

    // Remove both the apiKey and pathSegment from the path when forwarding to the target
    const res = await fetchWithTimeout(
      `${proxy.target}${pathWithoutApiKey.replace(
        `/${proxy.pathSegment}/`,
        "/",
      )}${url.search}`,
      {
        method: c.req.method,
        headers,
        body: c.req.raw.body,
        timeout: 60000,
      },
    )

    return new Response(res.body, {
      headers: res.headers,
      status: res.status,
    })
  }

  next()
})

export default app
