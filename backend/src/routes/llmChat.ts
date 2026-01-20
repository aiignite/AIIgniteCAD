import { Router, Response } from "express";
import { prisma } from "../index";
import { AuthRequest, authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

// Stream chat with LLM
router.post("/chat", async (req: AuthRequest, res: Response) => {
  try {
    const { message, assistantId, modelId } = req.body;
    const userId = req.user!.id;

    // Get LLM model configuration
    let llmModel;

    if (assistantId) {
      // Use assistant's configured LLM model
      const assistant = await prisma.assistant.findFirst({
        where: { id: assistantId, userId },
        include: { llmModel: true },
      });

      if (!assistant) {
        return res.status(404).json({ error: "Assistant not found" });
      }

      llmModel = assistant.llmModel;
    } else if (modelId) {
      // Use specified model
      llmModel = await prisma.lLMModel.findFirst({
        where: { id: modelId, OR: [{ userId }, { userId: null }] },
      });
    } else {
      // Use default active model
      llmModel = await prisma.lLMModel.findFirst({
        where: {
          userId,
          isActive: true,
        },
      });
    }

    if (!llmModel) {
      return res.status(400).json({ error: "No LLM model configured" });
    }

    // Decrypt API key
    let apiKey = llmModel.apiKeyEncrypted || "";
    if (apiKey && llmModel.provider !== "Ollama") {
      // TODO: Implement decryption
      // apiKey = decrypt(apiKey);
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Call LLM based on provider
    switch (llmModel.provider) {
      case "Ollama":
        await streamChatWithOllama(message, llmModel, res);
        break;
      case "Google":
        await streamChatWithGoogle(message, llmModel, apiKey, res);
        break;
      case "OpenAI":
        await streamChatWithOpenAI(message, llmModel, apiKey, res);
        break;
      case "Anthropic":
        await streamChatWithAnthropic(message, llmModel, apiKey, res);
        break;
      default:
        res.write(
          `data: ${JSON.stringify({ error: "Unsupported provider" })}\n\n`,
        );
    }

    res.end();
  } catch (error) {
    console.error("LLM chat error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        message:
          error instanceof Error ? error.message : "Failed to get response",
      });
    } else {
      res.write(
        `data: ${JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" })}\n\n`,
      );
      res.end();
    }
  }
});

// Ollama streaming chat
async function streamChatWithOllama(
  message: string,
  model: any,
  res: Response,
): Promise<void> {
  const configuration = model.configuration || {};
  const apiUrl = configuration.apiUrl || "http://localhost:11434";
  const modelId = model.modelId || "qwq";

  console.log(`[Ollama] Connecting to ${apiUrl} with model ${modelId}`);

  try {
    const response = await fetch(`${apiUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    console.log("[Ollama] Response received, starting stream...");

    // Read stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log(`[Ollama] Stream complete. Total chunks: ${chunkCount}`);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              chunkCount++;
              res.write(
                `data: ${JSON.stringify({ content: data.message.content })}\n\n`,
              );
              // Flush to ensure immediate delivery
              if (res.flush) res.flush();
            }
            if (data.done) {
              res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              if (res.flush) res.flush();
            }
          } catch (e) {
            console.error("Error parsing Ollama stream:", e);
          }
        }
      }
    }
  } catch (error) {
    console.error("Ollama chat error:", error);
    res.write(
      `data: ${JSON.stringify({ error: error instanceof Error ? error.message : "Ollama error" })}\n\n`,
    );
  }
}

// Google Gemini streaming chat
async function streamChatWithGoogle(
  message: string,
  model: any,
  apiKey: string,
  res: Response,
): Promise<void> {
  const apiUrl =
    model.configuration?.apiUrl ||
    "https://generativelanguage.googleapis.com/v1beta/models";
  const modelId = model.modelId || "gemini-pro";

  try {
    const response = await fetch(
      `${apiUrl}/${modelId}:streamGenerateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: message,
                },
              ],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google API error: ${response.status} - ${errorText}`);
    }

    // Read stream for Gemini
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
              if (res.flush) res.flush();
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    if (res.flush) res.flush();
  } catch (error) {
    console.error("Google chat error:", error);
    res.write(
      `data: ${JSON.stringify({ error: error instanceof Error ? error.message : "Google error" })}\n\n`,
    );
  }
}

// OpenAI streaming chat
async function streamChatWithOpenAI(
  message: string,
  model: any,
  apiKey: string,
  res: Response,
): Promise<void> {
  const apiUrl = model.configuration?.apiUrl || "https://api.openai.com/v1";
  const modelId = model.modelId || "gpt-3.5-turbo";

  try {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    // Read stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            if (res.flush) res.flush();
            break;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
              if (res.flush) res.flush();
            }
          } catch (e) {
            // Ignore parse errors for keep-alive lines
          }
        }
      }
    }
  } catch (error) {
    console.error("OpenAI chat error:", error);
    res.write(
      `data: ${JSON.stringify({ error: error instanceof Error ? error.message : "OpenAI error" })}\n\n`,
    );
  }
}

// Anthropic streaming chat
async function streamChatWithAnthropic(
  message: string,
  model: any,
  apiKey: string,
  res: Response,
): Promise<void> {
  const apiUrl = model.configuration?.apiUrl || "https://api.anthropic.com";
  const modelId = model.modelId || "claude-3-sonnet-20240229";

  try {
    const response = await fetch(`${apiUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 128000,
        messages: [
          {
            role: "user",
            content: message,
          },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
    }

    // Read stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "content_block_delta") {
              const content = parsed.delta?.text;
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
                if (res.flush) res.flush();
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    if (res.flush) res.flush();
  } catch (error) {
    console.error("Anthropic chat error:", error);
    res.write(
      `data: ${JSON.stringify({ error: error instanceof Error ? error.message : "Anthropic error" })}\n\n`,
    );
  }
}

export default router;
