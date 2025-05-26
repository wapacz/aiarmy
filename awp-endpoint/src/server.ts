import express, { Request, Response } from "express"
import {
  RunAgentInputSchema,
  RunAgentInput,
  EventType,
  Message,
} from "@ag-ui/core"
import { EventEncoder } from "@ag-ui/encoder"
import { OpenAI } from "openai"
import { v4 as uuidv4 } from "uuid"

const app = express()

app.use(express.json())

app.post("/awp", async (req: Request, res: Response) => {
  try {
    // Parse and validate the request body
    const input: RunAgentInput = RunAgentInputSchema.parse(req.body)

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")

    // Create an event encoder
    const encoder = new EventEncoder()

    // Send run started event
    const runStarted = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    }
    res.write(encoder.encode(runStarted))

    // Initialize OpenAI client
    const client = new OpenAI()

    // Convert AG-UI messages to OpenAI messages format
    const openaiMessages = input.messages
      .filter((msg: Message) =>
        ["user", "system", "assistant"].includes(msg.role)
      )
      .map((msg: Message) => ({
        role: msg.role as "user" | "system" | "assistant",
        content: msg.content || "",
      }))

    // Generate a message ID for the assistant's response
    const messageId = uuidv4()

    // Send text message start event
    const textMessageStart = {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    }
    res.write(encoder.encode(textMessageStart))

    // Create a streaming completion request
    const stream = await client.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: openaiMessages,
      stream: true,
    })

    // Process the streaming response and send content events
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        const content = chunk.choices[0].delta.content
        const textMessageContent = {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: content,
        }
        res.write(encoder.encode(textMessageContent))
      }
    }

    // Send text message end event
    const textMessageEnd = {
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    }
    res.write(encoder.encode(textMessageEnd))

    // Send run finished event
    const runFinished = {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    }
    res.write(encoder.encode(runFinished))

    // End the response
    res.end()
  } catch (error) {
    res.status(422).json({ error: (error as Error).message })
  }
})

app.listen(8000, () => {
  console.log("Server running on http://localhost:8000")
})