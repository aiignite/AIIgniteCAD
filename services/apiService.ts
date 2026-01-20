const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3410/api";

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface ProjectFile {
  id: string;
  name: string;
  description?: string;
  lastModified: string;
  lastOpened?: string;
  thumbnail?: string;
  elementCount?: number;
}

export interface LLMModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  isActive: boolean;
  configuration?: any;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  senderType: "user" | "ai";
  messageType: "text" | "action";
  content: string;
  metadata?: any;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

class ApiService {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem("auth_token");
  }

  private getHeaders() {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: this.getHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "API request failed");
    }

    return data;
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem("auth_token", token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem("auth_token");
  }

  isAuthenticated(): boolean {
    return !!this.token;
  }

  async register(username: string, email: string, password: string) {
    const data = await this.request<{ token: string; user: User }>(
      `/auth/register`,
      {
        method: "POST",
        body: JSON.stringify({ username, email, password }),
      },
    );
    this.setToken(data.token);
    return data;
  }

  async login(email: string, password: string) {
    const data = await this.request<{ token: string; user: User }>(
      `/auth/login`,
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );
    this.setToken(data.token);
    return data;
  }

  async logout() {
    await this.request(`/auth/logout`, {
      method: "POST",
    });
    this.clearToken();
  }

  async getCurrentUser() {
    return this.request<{ user: User }>(`/auth/me`);
  }

  async getProjects() {
    return this.request<{ projects: ProjectFile[]; total: number }>(
      `/projects`,
    );
  }

  async getProject(id: string) {
    return this.request<{ project: any }>(`/projects/${id}`);
  }

  async createProject(name: string, description?: string, thumbnail?: string) {
    return this.request<{ project: any }>(`/projects`, {
      method: "POST",
      body: JSON.stringify({ name, description, thumbnail }),
    });
  }

  async updateProject(
    id: string,
    data: { name?: string; description?: string; thumbnail?: string },
  ) {
    return this.request<{ project: any }>(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteProject(id: string) {
    return this.request(`/projects/${id}`, {
      method: "DELETE",
    });
  }

  async openProject(id: string) {
    return this.request(`/projects/${id}/open`, {
      method: "POST",
    });
  }

  async saveProjectElements(id: string, elements: any[]) {
    return this.request(`/projects/${id}/elements`, {
      method: "POST",
      body: JSON.stringify({ elements }),
    });
  }

  async getLLMModels() {
    return this.request<{ models: LLMModel[] }>(`/llm`);
  }

  async createLLMModel(data: {
    name: string;
    provider: string;
    modelId: string;
    apiKey?: string;
    isActive?: boolean;
    configuration?: any;
  }) {
    return this.request<{ model: LLMModel }>(`/llm`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateLLMModel(
    id: string,
    data: {
      name?: string;
      provider?: string;
      modelId?: string;
      apiKey?: string;
      isActive?: boolean;
      configuration?: any;
    },
  ) {
    return this.request<{ model: LLMModel }>(`/llm/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteLLMModel(id: string) {
    return this.request(`/llm/${id}`, {
      method: "DELETE",
    });
  }

  async getAssistants() {
    return this.request<{ assistants: any[] }>(`/assistants`);
  }

  async createAssistant(data: {
    name: string;
    icon: string;
    description: string;
    color: string;
    prompt?: string;
    isActive?: boolean;
    isPublic?: boolean;
    llmModelId?: string;
  }) {
    return this.request<{ assistant: any }>(`/assistants`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateAssistant(
    id: string,
    data: {
      name?: string;
      icon?: string;
      description?: string;
      color?: string;
      prompt?: string;
      isActive?: boolean;
      isPublic?: boolean;
      llmModelId?: string;
    },
  ) {
    return this.request<{ assistant: any }>(`/assistants/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteAssistant(id: string) {
    return this.request(`/assistants/${id}`, {
      method: "DELETE",
    });
  }

  async getChatSessions(projectId: string) {
    return this.request<{ sessions: ChatSession[] }>(
      `/chat/sessions/${projectId}`,
    );
  }

  async createChatSession(projectId: string) {
    return this.request<{ session: ChatSession }>(`/chat/sessions`, {
      method: "POST",
      body: JSON.stringify({ projectId }),
    });
  }

  async getChatMessages(sessionId: string) {
    return this.request<{ messages: ChatMessage[] }>(
      `/chat/sessions/${sessionId}/messages`,
    );
  }

  async addChatMessage(
    sessionId: string,
    data: {
      senderType: "user" | "ai";
      messageType: "text" | "action";
      content: string;
      metadata?: any;
    },
  ) {
    return this.request<{ chatMessage: ChatMessage }>(
      `/chat/sessions/${sessionId}/messages`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  async deleteChatSession(sessionId: string) {
    return this.request(`/chat/sessions/${sessionId}`, {
      method: "DELETE",
    });
  }

  async chatWithLLM(
    data: {
      message: string;
      assistantId?: string;
      modelId?: string;
    },
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<{ message: string; model: string }> {
    const response = await fetch(`${API_BASE_URL}/llm/chat`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(data),
      signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Failed to chat");
    }

    // Read stream
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let fullMessage = "";
    let modelName = "";

    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullMessage += parsed.content;
              if (onChunk) {
                onChunk(parsed.content);
              }
            }
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.model) {
              modelName = parsed.model;
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    }

    return { message: fullMessage, model: modelName };
  }
}

export const apiService = new ApiService();
