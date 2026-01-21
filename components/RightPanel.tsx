import React, { useState, useEffect, useRef } from "react";
import {
  SidePanelMode,
  ChatMessage,
  BlockDefinition,
  BlockCategory,
  CADElement,
  LLMModel,
  Assistant,
  DrawingSettings,
  ProjectFile,
} from "../types";
import { sendCADCommandToGemini } from "../services/geminiService";
import {
    getBlockTree,
    createCategory,
    createBlock,
    moveItem,
    deleteItem,
    getSuggestedBlockName
} from "../services/blockService";
import MarkdownMessage from "./MarkdownMessage";
import PropertyInspector from "./PropertyInspector";

// --- Helper: Optimize Context for LLM ---
const prepareContext = (elements: CADElement[]): string => {
  const MAX_ELEMENTS = 50; // Strict limit to save tokens

  // 1. Prioritize Selected
  const sorted = [...elements].sort((a, b) =>
    a.selected === b.selected ? 0 : a.selected ? -1 : 1,
  );

  // 2. Slice
  const targetElements = sorted.slice(0, MAX_ELEMENTS);

  if (targetElements.length === 0) return "[]";

  // 3. Simplify
  const simplified = targetElements.map((el) => {
    // Helper to round numbers
    const round = (v: number | undefined) =>
      v !== undefined ? Number(v.toFixed(2)) : undefined;
    const roundPt = (p: any) =>
      p ? { x: round(p.x), y: round(p.y) } : undefined;

    // Build minimal object
    const obj: any = {
      id: el.id,
      type: el.type,
      // Only include if true/present
      ...(el.selected && { status: "SELECTED" }),
      ...(el.layer && el.layer !== "0" && { layer: el.layer }),
      ...(el.color && { color: el.color }),
    };

    // Geometry
    if (el.start) obj.start = roundPt(el.start);
    if (el.end) obj.end = roundPt(el.end);
    if (el.center) obj.center = roundPt(el.center);
    if (el.radius) obj.radius = round(el.radius);
    if (el.width) obj.width = round(el.width);
    if (el.height) obj.height = round(el.height);
    if (el.text) obj.text = el.text;
    
    return obj;
  });

  let result = JSON.stringify(simplified);
  if (elements.length > MAX_ELEMENTS) {
    result += `\n... (and ${elements.length - MAX_ELEMENTS} more elements)`;
  }
  return result;
};

interface RightPanelProps {
  mode: SidePanelMode;
  onChangeMode: (mode: SidePanelMode) => void;
  currentElements: CADElement[];
  onUpdateElement: (el: CADElement) => void;
  onApplyAIAction: (
    operation: string,
    elements?: CADElement[],
    params?: any,
  ) => void;
  drawingSettings: DrawingSettings;
  onUpdateSettings: (settings: DrawingSettings) => void;
  // Files Props
  files: ProjectFile[];
  activeFileId: string | null;
  onLoadFile: (file: ProjectFile) => void;
  onCreateFile: (name: string) => void;
  onRenameFile: (id: string, newName: string) => void;
  onDeleteFile: (id: string) => void;
  // User Props
  currentUser?: any;
  onLogout?: () => void;
  onShowUserProfile?: () => void;
}

export const RightPanel: React.FC<RightPanelProps> = ({
  mode,
  onChangeMode,
  currentElements,
  onUpdateElement,
  onApplyAIAction,
  drawingSettings,
  onUpdateSettings,
  files,
  activeFileId,
  onLoadFile,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
  currentUser,
  onLogout,
  onShowUserProfile,
}) => {
  // --- STATE ---

  // Properties Panel State: INSPECTOR (Props+Layers), STRUCTURE (Old Model List), BLOCKS
  const [propTab, setPropTab] = useState<"INSPECTOR" | "STRUCTURE" | "BLOCKS">(
    "INSPECTOR",
  );

  // Blocks State
  const [blockTree, setBlockTree] = useState<{categories: BlockCategory[], rootBlocks: BlockDefinition[]}>({categories: [], rootBlocks: []});
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [blockSearch, setBlockSearch] = useState("");
  // Drag and Drop
  const [draggedBlockItem, setDraggedBlockItem] = useState<{type: 'block'|'category', id: string} | null>(null);

  // Structure Tab State
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(
    new Set(["0", "AI_GENERATED"]),
  );

  // Files State
  const [searchQuery, setSearchQuery] = useState("");
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // LLM Models State
  const [llmModels, setLlmModels] = useState<LLMModel[]>([]);
  const [showAddModel, setShowAddModel] = useState(false);
  const [editingModel, setEditingModel] = useState<LLMModel | null>(null);
  const [newModel, setNewModel] = useState({
    name: "",
    provider: "Google" as const,
    modelId: "",
    apiKey: "",
    apiUrl: "",
    isActive: true,
  });

  // Assistants State
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [selectedAssistant, setSelectedAssistant] = useState<Assistant | null>(
    null,
  );
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(
    null,
  );
  const [assistantForm, setAssistantForm] = useState({
    name: "",
    icon: "psychology",
    desc: "",
    color: "text-cad-primary",
    prompt: "",
    isActive: true,
    isPublic: false,
    llmModelId: "",
  });

  // User Profile Edit State
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    username: currentUser?.username || "",
    email: currentUser?.email || "",
  });
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [userMessage, setUserMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // UI State
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null); // ID of item with open menu
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  // Assistant panel width state (Frame 2)
  const [assistantPanelWidth, setAssistantPanelWidth] = useState(320); // Default w-80 = 20rem = 320px
  const [isResizingAssistant, setIsResizingAssistant] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartWidth, setDragStartWidth] = useState(320);

  // Load LLM models on mount
  useEffect(() => {
    loadLLMModels();
    loadAssistants();
  }, []);

  useEffect(() => {
    if (propTab === "BLOCKS") {
        loadBlockData();
    }
  }, [propTab]);

  const loadBlockData = async () => {
      try {
          // Load global blocks (not tied to any project) - blocks are shared across all drawings
          const data = await getBlockTree(undefined);
          setBlockTree(data);
      } catch (e) {
          console.error("Failed to load blocks", e);
      }
  };

  // Auto-expand panel when mode changes
  useEffect(() => {
    if (isPanelCollapsed) {
      setIsPanelCollapsed(false);
    }
  }, [mode]);

  // Handle assistant panel resize
  useEffect(() => {
    if (!isResizingAssistant) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = dragStartX - e.clientX;
      const newWidth = dragStartWidth + deltaX;

      if (newWidth >= 280 && newWidth <= 800) {
        setAssistantPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizingAssistant(false);
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingAssistant, dragStartX, dragStartWidth]);

  const handleAssistantResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizingAssistant(true);
    setDragStartX(e.clientX);
    setDragStartWidth(assistantPanelWidth);
  };

  const loadLLMModels = async () => {
    try {
      const { models } = await (
        await import("../services/apiService")
      ).apiService.getLLMModels();
      setLlmModels(
        models.map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          modelId: m.modelId || "",
          configuration: m.configuration || {},
          status: m.isActive ? "Active" : "Inactive",
        })),
      );
    } catch (error) {
      console.error("Failed to load LLM models:", error);
    }
  };

  const loadAssistants = async () => {
    try {
      const { assistants } = await (
        await import("../services/apiService")
      ).apiService.getAssistants();
      console.log("Loaded assistants:", assistants); // 调试日志
      setAssistants(assistants);
      // Removed auto-select to allow CAD Designer by default
    } catch (error) {
      console.error("Failed to load assistants:", error);
    }
  };

  const handleAddLLMModel = async () => {
    try {
      const modelData = {
        ...newModel,
        configuration: newModel.apiUrl
          ? { apiUrl: newModel.apiUrl }
          : undefined,
      };
      delete modelData.apiUrl;

      await (
        await import("../services/apiService")
      ).apiService.createLLMModel(modelData);
      await loadLLMModels();
      setShowAddModel(false);
      setNewModel({
        name: "",
        provider: "Google",
        modelId: "",
        apiKey: "",
        apiUrl: "",
        isActive: true,
      });
    } catch (error: any) {
      alert(error.message || "Failed to add model");
    }
  };

  const handleDeleteLLMModel = async (id: string) => {
    try {
      await (
        await import("../services/apiService")
      ).apiService.deleteLLMModel(id);
      await loadLLMModels();
    } catch (error: any) {
      alert(error.message || "Failed to delete model");
    }
  };

  const handleEditLLMModel = (model: LLMModel) => {
    setEditingModel(model);
    setNewModel({
      name: model.name,
      provider: model.provider as any,
      modelId: model.modelId || "",
      apiKey: "",
      apiUrl: (model as any).configuration?.apiUrl || "",
      isActive: model.status === "Active",
    });
    setShowAddModel(true);
  };

  const handleUpdateLLMModel = async () => {
    if (!editingModel) return;

    try {
      const modelData = {
        ...newModel,
        configuration: newModel.apiUrl
          ? { apiUrl: newModel.apiUrl }
          : undefined,
      };
      delete modelData.apiUrl;

      await (
        await import("../services/apiService")
      ).apiService.updateLLMModel(editingModel.id, modelData);
      await loadLLMModels();
      setShowAddModel(false);
      setEditingModel(null);
      setNewModel({
        name: "",
        provider: "Google",
        modelId: "",
        apiKey: "",
        apiUrl: "",
        isActive: true,
      });
    } catch (error: any) {
      alert(error.message || "Failed to update model");
    }
  };

  const handleEditAssistant = (assistant: Assistant) => {
    console.log("Editing assistant:", assistant); // 调试日志
    setEditingAssistant(assistant);
    setAssistantForm({
      name: assistant.name,
      icon: assistant.icon,
      desc: assistant.desc,
      color: assistant.color,
      prompt: (assistant as any).prompt || "",
      isActive:
        (assistant as any).isActive !== undefined
          ? (assistant as any).isActive
          : true,
      isPublic: (assistant as any).isPublic || false,
      llmModelId:
        (assistant as any).llmModelId || (assistant as any).llmModel?.id || "",
    });
    console.log(
      "Set assistantForm llmModelId to:",
      (assistant as any).llmModelId || (assistant as any).llmModel?.id || "",
    ); // 调试日志
  };

  const handleSaveAssistant = async () => {
    if (!editingAssistant) return;

    try {
      const api = await import("../services/apiService");

      const assistantData = {
        name: assistantForm.name,
        icon: assistantForm.icon,
        description: assistantForm.desc,
        color: assistantForm.color,
        prompt: assistantForm.prompt || undefined,
        isActive: assistantForm.isActive,
        isPublic: assistantForm.isPublic,
        llmModelId: assistantForm.llmModelId || undefined,
      };

      console.log("Saving assistant data:", assistantData); // 调试日志

      // 如果id为空字符串，说明是新建助手
      if (!editingAssistant.id || editingAssistant.id === "") {
        await api.apiService.createAssistant(assistantData);
      } else {
        // 否则是编辑现有助手
        await api.apiService.updateAssistant(
          editingAssistant.id,
          assistantData,
        );
      }
      await loadAssistants();
      setEditingAssistant(null);
    } catch (error: any) {
      console.error("Failed to save assistant:", error); // 调试日志
      alert(error.message || "Failed to save assistant");
    }
  };

  const handleDeleteAssistant = async (id: string) => {
    try {
      const api = await import("../services/apiService");
      await api.apiService.deleteAssistant(id);
      setAssistants((prev) => prev.filter((a) => a.id !== id));
    } catch (error: any) {
      alert(error.message || "Failed to delete assistant");
    }
  };

  const handleCreateAssistant = () => {
    setEditingAssistant({
      id: "",
      name: "",
      icon: "psychology",
      desc: "",
      color: "text-cad-primary",
      prompt: "",
      isActive: true,
      isPublic: false,
      llmModelId: "",
    } as Assistant);
    setAssistantForm({
      name: "",
      icon: "psychology",
      desc: "",
      color: "text-cad-primary",
      prompt: "",
      isActive: true,
      isPublic: false,
      llmModelId: "",
    });
  };

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      sender: "ai",
      text: "I'm ready to help with your floor plan. I can suggest furniture arrangements or optimize pathways. What are the constraints?",
      type: "text",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsGenerating(false);
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim()) return;
    if (isGenerating) {
      handleStopGeneration();
      return;
    }

    // 生成唯一 ID
    const generateId = () =>
      `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const userMsg: ChatMessage = {
      id: generateId(),
      sender: "user",
      text: inputValue,
      type: "text",
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setIsLoading(true);
    setIsGenerating(true);

    // 创建新的 AbortController
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // 如果选中了助手，使用助手的 LLM 模型进行流式聊天
      if (selectedAssistant) {
        const api = await import("../services/apiService");

        // 创建一个空的 AI 消息用于流式更新
        const aiMsgId = generateId();
        const initialAiMsg: ChatMessage = {
          id: aiMsgId,
          sender: "ai",
          text: "",
          type: "text",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, initialAiMsg]);

        // 如果是 CAD 助手，注入当前图纸的上下文
        let messageWithContext = userMsg.text;
        if (
          selectedAssistant.id === "cad-designer-id" ||
          selectedAssistant.name.toLowerCase().includes("cad")
        ) {
          const elementContext =
            currentElements.length > 0
              ? `\n\n[CONTEXT] Current elements on canvas: ${prepareContext(currentElements)}`
              : "\n\n[CONTEXT] The canvas is currently empty.";

          messageWithContext = `${userMsg.text}${elementContext}`;
        }

        // 流式接收响应
        let fullContent = "";
        await api.apiService.chatWithLLM(
          {
            message: messageWithContext,
            assistantId: selectedAssistant.id,
          },
          (chunk: string) => {
            fullContent += chunk;
            // 实时更新消息内容
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId ? { ...msg, text: msg.text + chunk } : msg,
              ),
            );
          },
          controller.signal,
        );

        // 如果是 CAD 助手，尝试解析 JSON 并应用
        if (
          selectedAssistant.id === "cad-designer-id" ||
          selectedAssistant.name.toLowerCase().includes("cad")
        ) {
          try {
            console.log("Analyzing AI response for CAD actions...");
            // 尝试从回答中寻找 JSON 块 - 更加鲁棒的提取方式
            const jsonRegex = /\{[\s\S]*\}/;
            const jsonMatch = fullContent.match(jsonRegex);
            if (jsonMatch) {
              let jsonStr = jsonMatch[0];
              // 移除可能的 Markdown 代码块标记 (如果匹配到了代码块外部)
              if (jsonStr.startsWith("```json")) {
                jsonStr = jsonStr.replace(/^```json\s*/, "");
              }
              if (jsonStr.endsWith("```")) {
                jsonStr = jsonStr.replace(/\s*```$/, "");
              }

              const parsed = JSON.parse(jsonStr);
              const op = parsed.operation?.toUpperCase();

              if (op && op !== "NONE") {
                console.log("Applying CAD action:", op, parsed.elements);
                // 处理元素 ID 和默认属性
                if (parsed.elements && Array.isArray(parsed.elements)) {
                  parsed.elements = parsed.elements.map((el: any) => {
                    // 如果模型返回了嵌套的 properties (如 GLM 有时会这样做)，将其拍平到顶层
                    const rawData = el.properties
                      ? { ...el, ...el.properties }
                      : el;

                    const normalized = {
                      ...rawData,
                      id: rawData.id || Math.random().toString(36).substr(2, 9),
                      color: rawData.color || rawData.fill || rawData.stroke || "#137fec",
                      layer: rawData.layer || "AI_GENERATED",
                      type: rawData.type?.toUpperCase(),
                    };

                    // 规范化矩形: 如果有 x, y 但没有 start
                    if (
                      normalized.type === "RECTANGLE" &&
                      !normalized.start &&
                      normalized.x !== undefined &&
                      normalized.y !== undefined
                    ) {
                      normalized.start = {
                        x: Number(normalized.x),
                        y: Number(normalized.y),
                      };
                    }

                    // 规范化矩形: 如果有 start 和 end, 计算 width 和 height
                    if (
                      normalized.type === "RECTANGLE" &&
                      normalized.start &&
                      normalized.end &&
                      normalized.width === undefined
                    ) {
                      normalized.width = normalized.end.x - normalized.start.x;
                      normalized.height = normalized.end.y - normalized.start.y;
                    }

                    // 规范化直线: 如果有 x1, y1, x2, y2 但没有 start/end
                    if (normalized.type === "LINE") {
                      if (!normalized.start && normalized.x1 !== undefined) {
                        normalized.start = {
                          x: Number(normalized.x1),
                          y: Number(normalized.y1),
                        };
                      }
                      if (!normalized.end && normalized.x2 !== undefined) {
                        normalized.end = {
                          x: Number(normalized.x2),
                          y: Number(normalized.y2),
                        };
                      }
                    }

                    // 规范化圆形: 如果有 cx, cy 但没有 center
                    if (
                      normalized.type === "CIRCLE" &&
                      !normalized.center &&
                      normalized.cx !== undefined
                    ) {
                      normalized.center = {
                        x: Number(normalized.cx),
                        y: Number(normalized.cy),
                      };
                    }

                    // 规范化圆形: 如果有 center 且没有 radius 但有 end/point, 计算 radius
                    if (
                      normalized.type === "CIRCLE" &&
                      normalized.center &&
                      normalized.radius === undefined
                    ) {
                      const endPt = normalized.end || normalized.point;
                      if (endPt) {
                        normalized.radius = Math.sqrt(
                          Math.pow(endPt.x - normalized.center.x, 2) +
                            Math.pow(endPt.y - normalized.center.y, 2),
                        );
                      }
                    }

                    return normalized;
                  });
                }
                onApplyAIAction(op, parsed.elements, parsed.params);
              }
            }
          } catch (e) {
            console.error("Failed to parse CAD action from assistant:", e);
          }
        }

        setIsLoading(false);
        setIsGenerating(false);
        abortControllerRef.current = null;
      } else {
        // 没有选中助手时，也改用系统 LLM 进行 CAD 操作
        // 查找 GLM 模型作为默认
        const glmModel = llmModels.find((m) =>
          m.name.toLowerCase().includes("glm"),
        );
        const modelId = glmModel?.id;

        const api = await import("../services/apiService");

        // 构造 CAD 专用 Prompt (包含完整状态和指令集)
        const elementList =
          currentElements.length > 0
            ? prepareContext(currentElements)
            : "[]";

        const cadPrompt = `You are an expert AI CAD Designer. 
The canvas coordinate system is: X increases right, Y increases down. Default size is 800x600.
CURRENT CANVAS ELEMENTS: ${elementList}

You can analyze the user request and provide a helpful response in natural language.
THEN, you MUST provide a JSON object in a markdown code block to perform the action.

JSON Structure:
1. "message": A short friendly confirmation (e.g., "I have moved the desk to the right.").
2. "operation": "ADD", "CLEAR", "DELETE_LAST", "COPY", "MOVE", "ROTATE", "MIRROR", or "NONE".
3. "elements": An array of elements. 
   - For ADD: Provide the new elements.
   - For MOVE/COPY/ROTATE/MIRROR: If you want to modify specific existing elements, YOU MUST RETURN THE EXACT "id" OF THOSE ELEMENTS. If you create new elements (like in COPY), new IDs will be generated.
4. "params": {dx, dy, angle, center:{x,y}, p1:{x,y}, p2:{x,y}} for transformations.

Logic:
- MODIFY (MOVE/ROTATE/MIRROR) existing elements by returning their objects WITH their original "id".
- If no elements are specified in JSON, operations will apply to currently SELECTED elements.

Supported types: LINE, RECTANGLE, CIRCLE, TEXT.

User Request: ${userMsg.text}`;

        const aiMsgId = generateId();
        const initialAiMsg: ChatMessage = {
          id: aiMsgId,
          sender: "ai",
          text: "",
          type: "text",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, initialAiMsg]);

        let fullContent = "";
        await api.apiService.chatWithLLM(
          {
            message: cadPrompt,
            modelId: modelId,
          },
          (chunk: string) => {
            fullContent += chunk;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === aiMsgId ? { ...msg, text: msg.text + chunk } : msg,
              ),
            );
          },
          controller.signal,
        );

        // 解析 CAD 操作
        try {
          const jsonRegex = /\{[\s\S]*\}/;
          const jsonMatch = fullContent.match(jsonRegex);
          if (jsonMatch) {
            let jsonStr = jsonMatch[0];
            // 移除可能的 Markdown 代码块标记
            if (jsonStr.startsWith("```json")) {
              jsonStr = jsonStr.replace(/^```json\s*/, "");
            }
            if (jsonStr.endsWith("```")) {
              jsonStr = jsonStr.replace(/\s*```$/, "");
            }

            const parsed = JSON.parse(jsonStr);
            const op = parsed.operation?.toUpperCase();

            if (op && op !== "NONE") {
              if (parsed.elements && Array.isArray(parsed.elements)) {
                parsed.elements = parsed.elements.map((el: any) => {
                  // 如果模型返回了嵌套的 properties，将其拍平
                  const rawData = el.properties
                    ? { ...el, ...el.properties }
                    : el;

                  const normalized = {
                    ...rawData,
                    id: rawData.id || Math.random().toString(36).substr(2, 9),
                    color: rawData.color || "#137fec",
                    layer: rawData.layer || "AI_GENERATED",
                    type: rawData.type?.toUpperCase(),
                  };

                  // 规范化矩形: 如果有 x, y 但没有 start
                  if (
                    normalized.type === "RECTANGLE" &&
                    !normalized.start &&
                    normalized.x !== undefined &&
                    normalized.y !== undefined
                  ) {
                    normalized.start = {
                      x: Number(normalized.x),
                      y: Number(normalized.y),
                    };
                  }

                  // 规范化矩形
                  if (
                    normalized.type === "RECTANGLE" &&
                    normalized.start &&
                    normalized.end &&
                    normalized.width === undefined
                  ) {
                    normalized.width = normalized.end.x - normalized.start.x;
                    normalized.height = normalized.end.y - normalized.start.y;
                  }

                  // 规范化直线: 如果有 x1, y1, x2, y2 但没有 start/end
                  if (normalized.type === "LINE") {
                    if (!normalized.start && normalized.x1 !== undefined) {
                      normalized.start = {
                        x: Number(normalized.x1),
                        y: Number(normalized.y1),
                      };
                    }
                    if (!normalized.end && normalized.x2 !== undefined) {
                      normalized.end = {
                        x: Number(normalized.x2),
                        y: Number(normalized.y2),
                      };
                    }
                  }

                  // 规范化圆形: 如果有 cx, cy 但没有 center
                  if (
                    normalized.type === "CIRCLE" &&
                    !normalized.center &&
                    normalized.cx !== undefined
                  ) {
                    normalized.center = {
                      x: Number(normalized.cx),
                      y: Number(normalized.cy),
                    };
                  }

                  // 规范化圆形
                  if (
                    normalized.type === "CIRCLE" &&
                    normalized.center &&
                    normalized.radius === undefined
                  ) {
                    const endPt = normalized.end || normalized.point;
                    if (endPt) {
                      normalized.radius = Math.sqrt(
                        Math.pow(endPt.x - normalized.center.x, 2) +
                          Math.pow(endPt.y - normalized.center.y, 2),
                      );
                    }
                  }

                  return normalized;
                });
              }
              onApplyAIAction(op, parsed.elements, parsed.params);
            }
          }
        } catch (e) {
          console.error("Failed to parse CAD action:", e);
        }

        setIsLoading(false);
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    } catch (e: any) {
      console.error(e);
      setIsLoading(false);
      setIsGenerating(false);
      abortControllerRef.current = null;

      // 如果是用户主动停止，不显示错误消息
      if (
        e.message !== "Generation stopped by user" &&
        !controller.signal.aborted
      ) {
        const errorMsg: ChatMessage = {
          id: generateId(),
          sender: "ai",
          text: "Sorry, I encountered an error. Please make sure your LLM model is configured correctly.",
          type: "text",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    }
  };

  const handleClearChat = () => {
    if (confirm("Are you sure you want to clear the chat history?")) {
      setMessages([
        {
          id: Date.now().toString(),
          sender: "ai",
          text: "Chat cleared. I'm ready to help.",
          type: "text",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    }
  };

  // --- PROPERTY UPDATE LOGIC ---
  const handlePropChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: string,
    isNumber = false,
  ) => {
    const selected = currentElements.find((el) => el.selected);
    if (!selected) return;

    let val: string | number = e.target.value;
    if (isNumber) {
      val = parseFloat(e.target.value);
      if (isNaN(val)) return; // Ignore invalid numbers
    }

    const newEl = { ...selected };

    if (field === "x") {
      const numVal = val as number;
      if (newEl.start) newEl.start = { ...newEl.start, x: numVal };
      if (newEl.center) newEl.center = { ...newEl.center, x: numVal };
    } else if (field === "y") {
      const numVal = val as number;
      if (newEl.start) newEl.start = { ...newEl.start, y: numVal };
      if (newEl.center) newEl.center = { ...newEl.center, y: numVal };
    } else if (field === "width") {
      newEl.width = val as number;
    } else if (field === "height") {
      newEl.height = val as number;
    } else if (field === "radius") {
      newEl.radius = val as number;
    } else if (field === "color") {
      newEl.color = String(val);
    } else if (field === "layer") {
      newEl.layer = String(val);
    }

    onUpdateElement(newEl);
  };

  const toggleLayer = (layerName: string) => {
    const newSet = new Set(expandedLayers);
    if (newSet.has(layerName)) {
      newSet.delete(layerName);
    } else {
      newSet.add(layerName);
    }
    setExpandedLayers(newSet);
  };

  const toggleSelection = (element: CADElement) => {
    onUpdateElement({ ...element, selected: !element.selected });
  };

  // Explicit handler to avoid type inference issues
  const handleDropdownToggle = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActiveDropdown(activeDropdown === id ? null : id);
  };

  const handleCreateFile = () => {
    onCreateFile("Untitled Drawing");
  };

  const startEditingFile = (file: ProjectFile) => {
    setEditingFileId(file.id);
    setEditName(file.name);
    setActiveDropdown(null);
  };

  const saveFileName = (id: string) => {
    if (editName.trim()) {
      onRenameFile(id, editName);
    }
    setEditingFileId(null);
  };

  // --- SUB-COMPONENT RENDERERS ---

  const DropdownMenu = ({
    onEdit,
    onDelete,
    editLabel = "Edit",
  }: {
    onEdit?: () => void;
    onDelete?: () => void;
    editLabel?: string;
  }) => (
    <div className="absolute right-0 top-6 w-32 bg-cad-panel border border-cad-border rounded shadow-xl z-50 flex flex-col py-1 animate-in fade-in zoom-in duration-100">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.();
        }}
        className="px-3 py-2 text-left text-xs text-cad-muted hover:bg-cad-text/10 hover:text-cad-text flex items-center gap-2"
      >
        <span className="material-symbols-outlined text-[14px]">edit</span>{" "}
        {editLabel}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete?.();
        }}
        className="px-3 py-2 text-left text-xs text-red-400 hover:bg-red-900/20 hover:text-red-300 flex items-center gap-2"
      >
        <span className="material-symbols-outlined text-[14px]">delete</span>{" "}
        Delete
      </button>
    </div>
  );

  const renderPropertiesAndStructure = () => {
    const selected = currentElements.find((e) => e.selected);
    const layers = Array.from(
      new Set(currentElements.map((el) => el.layer || "0")),
    ).sort();

    return (
      <div className="flex flex-col h-full bg-cad-panel">
        <div className="flex border-b border-cad-border bg-cad-panel">
          <button
            onClick={() => setPropTab("INSPECTOR")}
            className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 ${propTab === "INSPECTOR" ? "text-cad-primary border-cad-primary bg-cad-primary/10" : "text-cad-muted border-transparent hover:text-cad-text"}`}
          >
            Inspector
          </button>
          <button
            onClick={() => setPropTab("STRUCTURE")}
            className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 ${propTab === "STRUCTURE" ? "text-cad-primary border-cad-primary bg-cad-primary/10" : "text-cad-muted border-transparent hover:text-cad-text"}`}
          >
            Structure
          </button>
          <button
            onClick={() => setPropTab("BLOCKS")}
            className={`flex-1 py-3 text-xs font-bold transition-colors border-b-2 ${propTab === "BLOCKS" ? "text-cad-primary border-cad-primary bg-cad-primary/10" : "text-cad-muted border-transparent hover:text-cad-text"}`}
          >
            Blocks
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {propTab === "INSPECTOR" && (
            <PropertyInspector
              selectedElements={currentElements.filter((el) => el.selected)}
              onUpdateElement={onUpdateElement}
            />
          )}

          {propTab === "STRUCTURE" && (
            <div className="flex flex-col gap-2 p-4 overflow-y-auto h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-cad-muted font-bold uppercase">
                  Layers
                </span>
                <span className="text-[10px] text-gray-500">
                  {currentElements.length} Entities
                </span>
              </div>
              {layers.map((layerName: string) => {
                const layerElements = currentElements.filter(
                  (el) => (el.layer || "0") === layerName,
                );
                const isExpanded: boolean = expandedLayers.has(layerName);
                return (
                  <div
                    key={layerName}
                    className="border border-cad-border rounded bg-cad-bg overflow-hidden"
                  >
                    <div
                      className="flex items-center p-2 bg-cad-panel hover:bg-cad-border/50 cursor-pointer transition-colors"
                      onClick={() => toggleLayer(layerName)}
                    >
                      <span
                        className="material-symbols-outlined text-[16px] text-cad-muted mr-2 transform transition-transform duration-200"
                        style={{
                          transform: isExpanded
                            ? "rotate(90deg)"
                            : "rotate(0deg)",
                        }}
                      >
                        chevron_right
                      </span>
                      <span className="material-symbols-outlined text-[16px] text-cad-muted mr-2">
                        layers
                      </span>
                      <span className="text-xs font-bold text-cad-text flex-1">
                        {layerName}
                      </span>
                      <span className="text-[9px] text-cad-muted bg-cad-border/50 px-1.5 rounded-full">
                        {layerElements.length}
                      </span>
                    </div>
                    {isExpanded && (
                      <div className="flex flex-col gap-0.5 p-1 bg-cad-bg/50">
                        {layerElements.length === 0 ? (
                          <div className="p-2 text-center text-[10px] text-gray-500 italic">
                            Empty layer
                          </div>
                        ) : (
                          layerElements.map((el: CADElement) => (
                            <div
                              key={el.id}
                              onClick={() => toggleSelection(el)}
                              className={`flex items-center p-1.5 rounded-sm hover:bg-cad-text/5 cursor-pointer text-xs ml-2 border-l-2 border-transparent transition-all ${el.selected ? "bg-cad-primary/10 border-l-cad-primary text-cad-primary font-medium" : "text-cad-text"}`}
                            >
                              <span className="material-symbols-outlined text-[14px] mr-2 opacity-70">
                                {el.type === "LINE"
                                  ? "remove"
                                  : el.type === "CIRCLE"
                                    ? "circle"
                                    : el.type === "RECTANGLE"
                                      ? "rectangle"
                                      : el.type === "TEXT"
                                        ? "title"
                                        : el.type === "DIMENSION"
                                          ? "straighten"
                                          : el.type === "ARC"
                                            ? "architecture"
                                            : "polyline"}
                              </span>
                              <span className="truncate flex-1">{el.type}</span>
                              <span className="text-[9px] text-cad-muted font-mono">
                                {el.id.slice(0, 4)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="overflow-y-auto h-full">
            {propTab === "BLOCKS" && renderBlocksTab()}
          </div>
        </div>
      </div>
    );
  };

  // --- Block Handlers ---
  const handleCreateBlock = async () => {
    const selected = currentElements.filter(e => e.selected);
    if (selected.length === 0) {
        alert("Please select elements to create a block.");
        return;
    }
    
    const name = prompt("Enter block name:");
    if (!name) return;

    try {
        let x = 0, y = 0, count = 0;
        selected.forEach(e => {
            if (e.start) { x += e.start.x; y += e.start.y; count++; }
            else if (e.end) { x += e.end.x; y += e.end.y; count++; }
            else if (e.center) { x += e.center.x; y += e.center.y; count++; }
        });
        const basePoint = count > 0 ? { x: x/count, y: y/count } : { x: 0, y: 0 };
        
        // Create block as global (not tied to any project) - blocks are shared across all drawings
        await createBlock(name, selected, basePoint, undefined, undefined, undefined);
        await loadBlockData();
    } catch (e: any) {
        alert(e.message);
    }
  };

  const handleCreateCategory = async () => {
      const name = prompt("Category Name:");
      if (!name) return;
      // Create category as global (not tied to any project) - categories are shared across all drawings
      await createCategory(name, undefined, undefined);
      await loadBlockData();
  };

  const handleBlockDrop = async (targetId: string | null, isCategory: boolean) => {
      if (!draggedBlockItem) return;
      if (draggedBlockItem.id === targetId) return;
      try {
          await moveItem(draggedBlockItem.type, draggedBlockItem.id, targetId || undefined);
          await loadBlockData();
      } catch (e: any) {
          console.error(e);
      }
      setDraggedBlockItem(null);
  };

  const getFilteredTree = () => {
    if (!blockSearch) return blockTree;
    
    const lower = blockSearch.toLowerCase();
    
    const filterCat = (cat: BlockCategory): BlockCategory | null => {
         const matchingBlocks = cat.blocks?.filter(b => b.name.toLowerCase().includes(lower)) || [];
         const matchingChildren = cat.children
              ?.map(c => filterCat(c))
              .filter(c => c !== null) as BlockCategory[] || [];
         
         if (cat.name.toLowerCase().includes(lower) || matchingBlocks.length > 0 || matchingChildren.length > 0) {
             return {
                 ...cat,
                 blocks: matchingBlocks,
                 children: matchingChildren
             };
         }
         return null;
    };
    
    return {
        categories: blockTree.categories.map(c => filterCat(c)).filter(c => c !== null) as BlockCategory[],
        rootBlocks: blockTree.rootBlocks.filter(b => b.name.toLowerCase().includes(lower))
    };
  };

  const filteredTree = getFilteredTree();

  const renderBlockNode = (block: BlockDefinition) => (
      <div 
        key={block.id} 
        draggable
        onDragStart={(e) => {
            setDraggedBlockItem({type: 'block', id: block.id});
            e.dataTransfer.setData('blockId', block.id); // For Canvas Drop
            e.dataTransfer.effectAllowed = 'copy';
        }}
        className="flex items-center p-2 hover:bg-cad-hover/10 cursor-pointer text-sm"
      >
          <span className="material-symbols-outlined text-base mr-2 text-blue-400">deployed_code</span>
          {block.name}
      </div>
  );

  const renderCategoryNode = (category: BlockCategory) => {
      const isExpanded = expandedCategories.has(category.id) || blockSearch.length > 0;
      return (
          <div key={category.id} className="ml-2">
              <div 
                  className={`flex items-center p-2 hover:bg-cad-hover/10 cursor-pointer text-sm ${draggedBlockItem?.id === category.id ? "opacity-50" : ""}`}
                  draggable
                  onDragStart={(e) => {
                      e.stopPropagation();
                      setDraggedBlockItem({type: 'category', id: category.id});
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleBlockDrop(category.id, true);
                  }}
                  onClick={() => {
                      const newSet = new Set(expandedCategories);
                      if (isExpanded) newSet.delete(category.id);
                      else newSet.add(category.id);
                      setExpandedCategories(newSet);
                  }}
              >
                  <span className="material-symbols-outlined text-base mr-2 text-yellow-500">
                      {isExpanded ? 'folder_open' : 'folder'}
                  </span>
                  {category.name}
              </div>
              {isExpanded && (
                  <div className="ml-4 border-l border-gray-700 pl-1">
                       {category.children?.map(renderCategoryNode)}
                       {category.blocks?.map(renderBlockNode)}
                  </div>
              )}
          </div>
      );
  };

  const renderBlocksTab = () => (
      <div className="flex flex-col h-full">
           <div className="p-4 border-b border-gray-800 flex gap-2">
               <button onClick={handleCreateBlock} className="flex-1 bg-cad-primary text-white text-xs py-2 px-3 rounded flex items-center justify-center gap-2 hover:bg-blue-600">
                   <span className="material-symbols-outlined text-sm">add_box</span>
                   Block
               </button>
               <button onClick={handleCreateCategory} className="flex-1 bg-gray-700 text-white text-xs py-2 px-3 rounded flex items-center justify-center gap-2 hover:bg-gray-600">
                   <span className="material-symbols-outlined text-sm">create_new_folder</span>
                   Folder
               </button>
           </div>
           
           <div 
                className="flex-1 overflow-y-auto p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleBlockDrop(null, true)}
           >
                <input 
                    type="text" 
                    placeholder="Search blocks..." 
                    className="w-full bg-cad-bg-secondary border border-gray-700 rounded p-2 mb-2 text-xs text-cad-text outline-none"
                    value={blockSearch}
                    onChange={e => setBlockSearch(e.target.value)}
                />
               {filteredTree.categories.map(renderCategoryNode)}
               {filteredTree.rootBlocks.map(renderBlockNode)}
               
               {filteredTree.categories.length === 0 && filteredTree.rootBlocks.length === 0 && (
                   <p className="text-gray-500 text-xs text-center mt-8">No blocks found</p>
               )}
           </div>
      </div>
  );

  const renderFiles = () => {
    const filteredFiles = files.filter((f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    return (
      <div className="flex flex-col h-full bg-cad-bg">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
          <h3 className="text-sm font-bold text-cad-text">Project Files</h3>
          <div className="flex items-center gap-2">
            <button
              className="p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text"
              title="Sort"
            >
              <span className="material-symbols-outlined text-[20px]">
                sort
              </span>
            </button>
            <button
              onClick={handleCreateFile}
              className="flex items-center justify-center size-6 bg-cad-primary text-white rounded hover:bg-cad-primaryHover transition-colors shadow-sm"
              title="New File"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-3 border-b border-cad-border bg-cad-bg">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-gray-400">
              search
            </span>
            <input
              type="text"
              placeholder="Search files..."
              className="w-full h-8 pl-8 pr-3 rounded bg-cad-panel border border-cad-border text-xs text-cad-text focus:border-cad-primary focus:ring-1 focus:ring-cad-primary outline-none transition-all placeholder-gray-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredFiles.map((file: ProjectFile) => (
            <div
              key={file.id}
              onClick={() => onLoadFile(file)}
              className={`group relative flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                activeFileId === file.id
                  ? "bg-cad-primary/10 border-cad-primary/30"
                  : "hover:bg-cad-text/5 border-transparent hover:border-cad-border"
              }`}
            >
              <div
                className={`size-8 rounded flex items-center justify-center mr-3 ${
                  activeFileId === file.id
                    ? "bg-cad-primary text-white"
                    : "bg-blue-100 dark:bg-blue-900/30 text-cad-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  description
                </span>
              </div>

              <div className="flex-1 min-w-0">
                {editingFileId === file.id ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => saveFileName(file.id)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && saveFileName(file.id)
                    }
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-cad-bg border border-cad-primary rounded px-1 py-0.5 text-xs text-cad-text outline-none"
                  />
                ) : (
                  <h4 className="text-sm font-medium text-cad-text truncate">
                    {file.name}
                  </h4>
                )}
                <span className="text-[10px] text-cad-muted">
                  {file.lastModified}
                </span>
              </div>

              <button
                onClick={(e) => handleDropdownToggle(e, file.id)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-opacity"
              >
                <span className="material-symbols-outlined text-[18px]">
                  more_vert
                </span>
              </button>

              {activeDropdown === file.id && (
                <DropdownMenu
                  onEdit={() => startEditingFile(file)}
                  onDelete={() => onDeleteFile(file.id)}
                />
              )}
            </div>
          ))}

          {filteredFiles.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-cad-muted">
              <span className="material-symbols-outlined text-[48px] opacity-20 mb-2">
                folder_off
              </span>
              <p className="text-xs">No files found</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderLLMModels = () => {
    return (
      <div className="flex flex-col h-full bg-cad-bg">
        <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
          <h3 className="text-sm font-bold text-cad-text">LLM Models</h3>
          <button
            onClick={() => setShowAddModel(true)}
            className="flex items-center justify-center size-6 rounded hover:bg-cad-text/10 text-gray-400 hover:text-cad-text transition-colors"
            title="Add Model"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
          </button>
        </div>

        {showAddModel && (
          <div className="flex-1 p-4 border-b border-cad-border bg-cad-panel overflow-y-auto">
            <h4 className="text-xs font-bold text-cad-text mb-3">
              {editingModel ? `Edit ${editingModel.name}` : "Add New Model"}
            </h4>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  Name
                </label>
                <input
                  type="text"
                  value={newModel.name}
                  onChange={(e) =>
                    setNewModel({ ...newModel, name: e.target.value })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                  placeholder="Model name"
                />
              </div>
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  Provider
                </label>
                <select
                  value={newModel.provider}
                  onChange={(e) =>
                    setNewModel({
                      ...newModel,
                      provider: e.target.value as any,
                    })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                >
                  <option value="Google">Google</option>
                  <option value="Anthropic">Anthropic</option>
                  <option value="OpenAI">OpenAI</option>
                  <option value="Ollama">Ollama</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  Model ID
                </label>
                <input
                  type="text"
                  value={newModel.modelId}
                  onChange={(e) =>
                    setNewModel({ ...newModel, modelId: e.target.value })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                  placeholder="e.g., gemini-1.5-pro"
                />
              </div>
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  API Key (Optional)
                </label>
                <input
                  type="password"
                  value={newModel.apiKey}
                  onChange={(e) =>
                    setNewModel({ ...newModel, apiKey: e.target.value })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                  placeholder="••••••••••••••"
                />
              </div>
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  API URL (Optional)
                </label>
                <input
                  type="text"
                  value={newModel.apiUrl}
                  onChange={(e) =>
                    setNewModel({ ...newModel, apiUrl: e.target.value })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                  placeholder="e.g., https://open.bigmodel.cn/api/anthropic/v1"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-cad-muted font-medium">
                  Active
                </label>
                <button
                  type="button"
                  onClick={() => setNewModel({ ...newModel, isActive: !newModel.isActive })}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 ease-in-out ${
                    newModel.isActive ? "bg-cad-primary" : "bg-gray-300 dark:bg-gray-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ease-in-out ${
                      newModel.isActive ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={
                    editingModel ? handleUpdateLLMModel : handleAddLLMModel
                  }
                  className="flex-1 py-2 px-4 bg-cad-primary text-white text-xs font-bold rounded hover:bg-cad-primaryHover transition-colors"
                >
                  {editingModel ? "Update Model" : "Add Model"}
                </button>
                <button
                  onClick={() => {
                    setShowAddModel(false);
                    setEditingModel(null);
                    setNewModel({
                      name: "",
                      provider: "Google",
                      modelId: "",
                      apiKey: "",
                      apiUrl: "",
                      isActive: true,
                    });
                  }}
                  className="flex-1 py-2 px-4 bg-cad-border/50 text-cad-text text-xs font-bold rounded hover:bg-cad-border/70 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {!showAddModel && (
          <div className="flex-1 overflow-y-auto p-2">
            {llmModels.map((model) => (
              <div
                key={model.id}
                className="group relative flex items-center justify-between p-3 rounded-lg hover:bg-cad-text/5 border border-transparent hover:border-cad-border mb-2 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`size-2 rounded-full ${model.status === "Active" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-gray-600"}`}
                  ></div>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-cad-text">
                      {model.name}
                    </span>
                    <span className="text-[10px] text-cad-muted">
                      {model.provider}{model.modelId ? ` · ${model.modelId}` : ""}
                    </span>
                  </div>
                </div>

                <button
                  onClick={(e) => handleDropdownToggle(e, model.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-opacity"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    more_vert
                  </span>
                </button>

                {activeDropdown === model.id && (
                  <DropdownMenu
                    onEdit={() => handleEditLLMModel(model)}
                    onDelete={() => handleDeleteLLMModel(model.id)}
                    editLabel="Edit"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderAssistants = () => {
    return (
      <div className="flex flex-col h-full bg-cad-bg">
        <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
          <h3 className="text-sm font-bold text-cad-text">Assistants</h3>
          <button
            onClick={handleCreateAssistant}
            className="flex items-center justify-center size-6 rounded hover:bg-cad-text/10 text-gray-400 hover:text-cad-text transition-colors"
            title="Create Assistant"
          >
            <span className="material-symbols-outlined text-[20px]">add</span>
          </button>
        </div>

        {editingAssistant && (
          <div className="p-4 border-b border-cad-border bg-cad-panel max-h-[60vh] overflow-y-auto">
            <h4 className="text-xs font-bold text-cad-text mb-3">
              {editingAssistant.name
                ? `Edit ${editingAssistant.name}`
                : "Create New Assistant"}
            </h4>
            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  Name
                </label>
                <input
                  type="text"
                  value={assistantForm.name}
                  onChange={(e) =>
                    setAssistantForm({ ...assistantForm, name: e.target.value })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                  placeholder="Assistant name"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  Description
                </label>
                <input
                  type="text"
                  value={assistantForm.desc}
                  onChange={(e) =>
                    setAssistantForm({ ...assistantForm, desc: e.target.value })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                  placeholder="Brief description"
                />
              </div>

              {/* Icon */}
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  Icon
                </label>
                <select
                  value={assistantForm.icon}
                  onChange={(e) =>
                    setAssistantForm({ ...assistantForm, icon: e.target.value })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                >
                  <option value="psychology">psychology</option>
                  <option value="smart_toy">smart_toy</option>
                  <option value="auto_awesome">auto_awesome</option>
                  <option value="lightbulb">lightbulb</option>
                  <option value="school">school</option>
                  <option value="engineering">engineering</option>
                  <option value="architecture">architecture</option>
                  <option value="design_services">design_services</option>
                  <option value="draw">draw</option>
                  <option value="rule">rule</option>
                  <option value="square_foot">square_foot</option>
                  <option value="home_work">home_work</option>
                  <option value="apartment">apartment</option>
                  <option value="domain">domain</option>
                  <option value="verified">verified</option>
                  <option value="health_and_safety">health_and_safety</option>
                  <option value="electrical_services">
                    electrical_services
                  </option>
                  <option value="water_drop">water_drop</option>
                  <option value="waves">waves</option>
                  <option value="analytics">analytics</option>
                </select>
              </div>

              {/* Color */}
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  Color
                </label>
                <select
                  value={assistantForm.color}
                  onChange={(e) =>
                    setAssistantForm({
                      ...assistantForm,
                      color: e.target.value,
                    })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                >
                  <option value="text-cad-primary">Blue (Primary)</option>
                  <option value="text-cyan-400">Cyan</option>
                  <option value="text-blue-400">Blue</option>
                  <option value="text-green-400">Green</option>
                  <option value="text-yellow-400">Yellow</option>
                  <option value="text-orange-400">Orange</option>
                  <option value="text-red-400">Red</option>
                  <option value="text-purple-400">Purple</option>
                  <option value="text-pink-400">Pink</option>
                </select>
              </div>

              {/* Prompt (System Message) */}
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  System Prompt (Optional)
                </label>
                <textarea
                  value={assistantForm.prompt}
                  onChange={(e) =>
                    setAssistantForm({
                      ...assistantForm,
                      prompt: e.target.value,
                    })
                  }
                  className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-2 text-xs text-cad-text resize-none"
                  placeholder="Custom instructions for this assistant..."
                  rows={4}
                />
              </div>

              {/* Active Status */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="assistant-active"
                  checked={assistantForm.isActive}
                  onChange={(e) =>
                    setAssistantForm({
                      ...assistantForm,
                      isActive: e.target.checked,
                    })
                  }
                  className="w-4 h-4 rounded border-cad-border"
                />
                <label
                  htmlFor="assistant-active"
                  className="text-[10px] text-cad-muted font-medium cursor-pointer"
                >
                  Active
                </label>
              </div>

              {/* Public Status */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="assistant-public"
                  checked={assistantForm.isPublic}
                  onChange={(e) =>
                    setAssistantForm({
                      ...assistantForm,
                      isPublic: e.target.checked,
                    })
                  }
                  className="w-4 h-4 rounded border-cad-border"
                />
                <label
                  htmlFor="assistant-public"
                  className="text-[10px] text-cad-muted font-medium cursor-pointer"
                >
                  Public (visible to all users)
                </label>
              </div>

              {/* LLM Model */}
              <div>
                <label className="text-[10px] text-cad-muted font-medium">
                  LLM Model
                </label>
                <select
                  value={assistantForm.llmModelId}
                  onChange={(e) =>
                    setAssistantForm({
                      ...assistantForm,
                      llmModelId: e.target.value,
                    })
                  }
                  className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs text-cad-text"
                >
                  <option value="">Use default model</option>
                  {llmModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.provider})
                    </option>
                  ))}
                </select>
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSaveAssistant}
                  className="flex-1 py-2 px-4 bg-cad-primary text-white text-xs font-bold rounded hover:bg-cad-primaryHover transition-colors"
                >
                  {editingAssistant.id ? "Save" : "Create"}
                </button>
                <button
                  onClick={() => {
                    setEditingAssistant(null);
                    setAssistantForm({
                      name: "",
                      icon: "psychology",
                      desc: "",
                      color: "text-cad-primary",
                      prompt: "",
                      isActive: true,
                      isPublic: false,
                      llmModelId: "",
                    });
                  }}
                  className="flex-1 py-2 px-4 bg-cad-border/50 text-cad-text text-xs font-bold rounded hover:bg-cad-border/70 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {!editingAssistant && (
          <div className="grid grid-cols-1 gap-3 p-4">
            {assistants.map((a) => (
              <div
                key={a.id}
                className={`relative group bg-cad-panel border p-3 rounded-lg hover:border-cad-primary transition-all flex items-start gap-3 ${(a as any).isActive === false ? "border-cad-border/50 opacity-60" : "border-cad-border"}`}
              >
                <div
                  onClick={() => {
                    if ((a as any).isActive !== false) {
                      setSelectedAssistant(a);
                      onChangeMode(SidePanelMode.CHAT);
                    }
                  }}
                  className={`flex-1 flex gap-3 ${(a as any).isActive === false ? "" : "cursor-pointer"}`}
                >
                  <div className="p-2 bg-black/10 dark:bg-black/30 rounded-md shrink-0">
                    <span
                      className={`material-symbols-outlined ${a.color} text-[24px]`}
                    >
                      {a.icon}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-cad-text group-hover:text-cad-primary transition-colors truncate">
                        {a.name}
                      </h4>
                      {(a as any).isActive === false && (
                        <span className="text-[9px] bg-gray-200 dark:bg-gray-700 text-gray-500 px-1.5 py-0.5 rounded font-medium">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-cad-muted leading-tight mt-1 truncate">
                      {a.desc}
                    </p>
                  </div>
                </div>

                <button
                  onClick={(e) => handleDropdownToggle(e, a.id)}
                  className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-opacity"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    more_vert
                  </span>
                </button>

                {activeDropdown === a.id && (
                  <DropdownMenu
                    onEdit={() => handleEditAssistant(a)}
                    onDelete={() => handleDeleteAssistant(a.id)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSettings = () => (
    <div className="flex flex-col h-full bg-cad-bg">
      <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
        <h3 className="text-sm font-bold text-cad-text">Drawing Settings</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Coordinate System */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
            Coordinate System
          </h4>
          <div className="space-y-2">
            <label className="text-xs text-cad-text font-medium">
              Drawing Units
            </label>
            <div className="flex rounded border border-cad-border bg-cad-panel overflow-hidden">
              {(["mm", "cm", "m", "in", "ft"] as const).map((u) => (
                <button
                  key={u}
                  onClick={() =>
                    onUpdateSettings({ ...drawingSettings, units: u })
                  }
                  className={`flex-1 py-1.5 text-xs font-mono transition-colors ${drawingSettings.units === u ? "bg-cad-primary text-white" : "text-cad-muted hover:bg-cad-border/50"}`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-cad-muted font-medium">
                Grid Spacing
              </label>
              <input
                type="number"
                value={drawingSettings.gridSpacing}
                onChange={(e) =>
                  onUpdateSettings({
                    ...drawingSettings,
                    gridSpacing: parseFloat(e.target.value) || 10,
                  })
                }
                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-cad-muted font-medium">
                Snap Dist
              </label>
              <input
                type="number"
                value={drawingSettings.snapDistance}
                onChange={(e) =>
                  onUpdateSettings({
                    ...drawingSettings,
                    snapDistance: parseFloat(e.target.value) || 1,
                  })
                }
                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
              />
            </div>
          </div>
        </div>

        <div className="h-px bg-cad-border"></div>

        {/* Dimension Style */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
            Dimension Style
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-cad-muted font-medium">
                Scale Factor
              </label>
              <input
                type="number"
                step="0.1"
                value={drawingSettings.dimScale}
                onChange={(e) =>
                  onUpdateSettings({
                    ...drawingSettings,
                    dimScale: parseFloat(e.target.value) || 1,
                  })
                }
                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-cad-muted font-medium">
                Precision
              </label>
              <input
                type="number"
                min="0"
                max="8"
                value={drawingSettings.dimPrecision}
                onChange={(e) =>
                  onUpdateSettings({
                    ...drawingSettings,
                    dimPrecision: parseInt(e.target.value) || 0,
                  })
                }
                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-2 text-xs font-mono"
              />
            </div>
          </div>
          <div className="p-3 bg-cad-panel rounded border border-cad-border flex flex-col items-center justify-center h-20 overflow-hidden relative">
            <span className="text-[10px] text-cad-muted absolute top-1 left-2">
              Preview
            </span>
            {/* Mini preview of a dimension */}
            <svg width="150" height="40" className="overflow-visible">
              <line
                x1="10"
                y1="30"
                x2="140"
                y2="30"
                stroke="#4ade80"
                strokeWidth="1"
              />
              <line
                x1="10"
                y1="25"
                x2="10"
                y2="35"
                stroke="#4ade80"
                strokeWidth="1"
              />
              <line
                x1="140"
                y1="25"
                x2="140"
                y2="35"
                stroke="#4ade80"
                strokeWidth="1"
              />
              <text
                x="75"
                y="20"
                textAnchor="middle"
                fill="#4ade80"
                fontSize={10 * drawingSettings.dimScale}
                fontFamily="monospace"
              >
                {(100.23456).toFixed(drawingSettings.dimPrecision)}
              </text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );

  const renderUserInfo = () => {
    if (editingProfile) {
      return (
        <div className="flex flex-col h-full bg-cad-bg">
          <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
            <h3 className="text-sm font-bold text-cad-text">Edit Profile</h3>
            <button
              onClick={() => setEditingProfile(false)}
              className="p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-cad-muted">Username</label>
              <input
                type="text"
                value={profileForm.username}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, username: e.target.value })
                }
                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-cad-muted">Email</label>
              <input
                type="email"
                value={profileForm.email}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, email: e.target.value })
                }
                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
              />
            </div>

            {userMessage && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  userMessage.type === "success"
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {userMessage.text}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-cad-border flex gap-2 bg-cad-panel">
            <button
              onClick={() => setEditingProfile(false)}
              className="flex-1 py-2 px-3 bg-cad-border/50 text-cad-text text-xs font-bold rounded hover:bg-cad-border/70 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                try {
                  const api = await import("../services/apiService");
                  await api.apiService.updateProfile({
                    username: profileForm.username,
                    email: profileForm.email,
                  });
                  setUserMessage({ type: "success", text: "Profile updated successfully" });
                  setTimeout(() => setEditingProfile(false), 1500);
                } catch (e: any) {
                  setUserMessage({ type: "error", text: e.message || "Failed to update profile" });
                }
              }}
              className="flex-1 py-2 px-3 bg-cad-primary text-white text-xs font-bold rounded hover:bg-cad-primaryHover transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      );
    }

    if (editingPassword) {
      return (
        <div className="flex flex-col h-full bg-cad-bg">
          <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
            <h3 className="text-sm font-bold text-cad-text">Change Password</h3>
            <button
              onClick={() => setEditingPassword(false)}
              className="p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-cad-muted">Current Password</label>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) =>
                  setPasswordForm({
                    ...passwordForm,
                    currentPassword: e.target.value,
                  })
                }
                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
                placeholder="Enter current password"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-cad-muted">New Password</label>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) =>
                  setPasswordForm({
                    ...passwordForm,
                    newPassword: e.target.value,
                  })
                }
                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
                placeholder="Enter new password"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-cad-muted">Confirm Password</label>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) =>
                  setPasswordForm({
                    ...passwordForm,
                    confirmPassword: e.target.value,
                  })
                }
                className="w-full h-8 bg-white dark:bg-black/20 border border-cad-border rounded px-3 text-sm text-cad-text focus:border-cad-primary outline-none"
                placeholder="Confirm new password"
              />
            </div>

            {userMessage && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  userMessage.type === "success"
                    ? "bg-green-500/10 border-green-500/30 text-green-400"
                    : "bg-red-500/10 border-red-500/30 text-red-400"
                }`}
              >
                {userMessage.text}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-cad-border flex gap-2 bg-cad-panel">
            <button
              onClick={() => {
                setEditingPassword(false);
                setPasswordForm({
                  currentPassword: "",
                  newPassword: "",
                  confirmPassword: "",
                });
              }}
              className="flex-1 py-2 px-3 bg-cad-border/50 text-cad-text text-xs font-bold rounded hover:bg-cad-border/70 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                if (passwordForm.newPassword !== passwordForm.confirmPassword) {
                  setUserMessage({ type: "error", text: "Passwords do not match" });
                  return;
                }
                if (passwordForm.newPassword.length < 6) {
                  setUserMessage({ type: "error", text: "Password must be at least 6 characters" });
                  return;
                }
                try {
                  const api = await import("../services/apiService");
                  await api.apiService.changePassword({
                    currentPassword: passwordForm.currentPassword,
                    newPassword: passwordForm.newPassword,
                  });
                  setUserMessage({ type: "success", text: "Password changed successfully" });
                  setTimeout(() => {
                    setEditingPassword(false);
                    setPasswordForm({
                      currentPassword: "",
                      newPassword: "",
                      confirmPassword: "",
                    });
                  }, 1500);
                } catch (e: any) {
                  setUserMessage({ type: "error", text: e.message || "Failed to change password" });
                }
              }}
              className="flex-1 py-2 px-3 bg-cad-primary text-white text-xs font-bold rounded hover:bg-cad-primaryHover transition-colors"
            >
              Update Password
            </button>
          </div>
        </div>
      );
    }

    return (
    <div className="flex flex-col h-full bg-cad-bg">
      <div className="flex items-center justify-between p-4 border-b border-cad-border bg-cad-panel">
        <h3 className="text-sm font-bold text-cad-text">User Profile</h3>
        <button
          onClick={() => onChangeMode(SidePanelMode.SETTINGS)}
          className="p-1 hover:bg-cad-text/10 rounded text-gray-400 hover:text-cad-text transition-colors"
          title="Settings"
        >
          <span className="material-symbols-outlined text-[20px]">
            settings
          </span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* User Avatar & Basic Info */}
        <div className="p-6 flex flex-col items-center border-b border-cad-border bg-cad-panel">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#137fec] to-[#0b63c1] flex items-center justify-center text-white text-2xl font-bold shadow-lg mb-4">
            {currentUser?.username?.substring(0, 2).toUpperCase() || "U"}
          </div>
          <h4 className="text-lg font-bold text-cad-text">
            {currentUser?.username || "User"}
          </h4>
          <p className="text-xs text-cad-muted mt-1">
            {currentUser?.email || ""}
          </p>
          <span className="mt-3 px-3 py-1 bg-cad-primary/20 text-cad-primary text-xs font-semibold rounded-full border border-cad-primary/30">
            Engineer
          </span>
        </div>

        {/* Account Details */}
        <div className="p-4 space-y-4">
          <div className="space-y-3">
            <h5 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
              Account Details
            </h5>

            <div className="bg-cad-panel rounded-lg border border-cad-border p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-cad-muted">User ID</span>
                <span className="text-xs font-mono text-cad-text truncate max-w-[150px]">
                  {currentUser?.id || "N/A"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-cad-muted">Member Since</span>
                <span className="text-xs text-cad-text">
                  {currentUser?.createdAt
                    ? new Date(currentUser.createdAt).toLocaleDateString()
                    : "N/A"}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-3">
            <h5 className="text-xs font-bold text-cad-muted uppercase tracking-wider">
              Quick Actions
            </h5>

            <button
              onClick={() => {
                setEditingProfile(true);
                setProfileForm({
                  username: currentUser?.username || "",
                  email: currentUser?.email || "",
                });
              }}
              className="w-full flex items-center gap-3 p-3 bg-cad-panel hover:bg-cad-text/5 rounded-lg border border-cad-border transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[18px] text-cad-primary">
                account_circle
              </span>
              <div>
                <p className="text-xs font-semibold text-cad-text">
                  Edit Profile
                </p>
                <p className="text-[10px] text-cad-muted">
                  Update your information
                </p>
              </div>
            </button>

            <button
              onClick={() => {
                setEditingPassword(true);
                setPasswordForm({
                  currentPassword: "",
                  newPassword: "",
                  confirmPassword: "",
                });
              }}
              className="w-full flex items-center gap-3 p-3 bg-cad-panel hover:bg-cad-text/5 rounded-lg border border-cad-border transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[18px] text-cad-primary">
                security
              </span>
              <div>
                <p className="text-xs font-semibold text-cad-text">
                  Change Password
                </p>
                <p className="text-[10px] text-cad-muted">
                  Update your security
                </p>
              </div>
            </button>

            <a
              href="https://github.com/AIIgnite/AIIgniteCAD/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 p-3 bg-cad-panel hover:bg-cad-text/5 rounded-lg border border-cad-border transition-colors text-left"
            >
              <span className="material-symbols-outlined text-[18px] text-cad-primary">
                help
              </span>
              <div>
                <p className="text-xs font-semibold text-cad-text">
                  Help & Support
                </p>
                <p className="text-[10px] text-cad-muted">Get assistance</p>
              </div>
            </a>
          </div>

          {/* Logout Button */}
          <div className="pt-4 border-t border-cad-border">
            <button
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 hover:text-red-400 rounded-lg border border-red-500/30 transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">
                logout
              </span>
              <span className="text-xs font-bold">Logout</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    );
  };

  const renderChat = () => (
    <div className="flex flex-col h-full bg-cad-bg">
      <div className="flex items-center justify-between px-4 py-2 border-b border-cad-border bg-cad-panel">
        <div className="flex items-center gap-3 flex-1">
          <div className="p-2 bg-black/10 dark:bg-black/30 rounded-md shrink-0">
            <span
              className={`material-symbols-outlined ${selectedAssistant ? selectedAssistant.color : "text-cad-primary"} text-[24px]`}
            >
              {selectedAssistant ? selectedAssistant.icon : "architecture"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <select
              value={selectedAssistant?.id || ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "") {
                  setSelectedAssistant(null);
                } else {
                  const assistant = assistants.find((a) => a.id === val);
                  if (assistant) setSelectedAssistant(assistant);
                }
              }}
              className="w-full text-sm font-bold text-cad-text leading-none bg-transparent border-0 p-0 focus:ring-0 cursor-pointer"
            >
              <option value="">AI CAD Designer</option>
              {assistants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-cad-muted mt-0.5 truncate">
              {selectedAssistant 
                ? selectedAssistant.desc 
                : "Draw shapes and layouts using AI commands"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] bg-cad-primary/20 text-cad-primary px-1.5 py-0.5 rounded font-mono border border-cad-primary/30">
            {selectedAssistant ? "ASSISTANT" : "CAD MODE"}
          </span>
        </div>
      </div>

      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-cad-bg"
      >
        {messages.map((msg) => (
          <ChatMessageItem key={msg.id} msg={msg} />
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <div className="size-8 rounded-full bg-white dark:bg-[#1e293b] flex items-center justify-center shrink-0 border border-cad-border">
              <span className="material-symbols-outlined text-cad-primary text-[16px] animate-spin">
                sync
              </span>
            </div>
            <div className="flex items-center">
              <div className="typing-indicator flex gap-1">
                <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"></span>
                <span
                  className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.1s" }}
                ></span>
                <span
                  className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0.2s" }}
                ></span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 py-2 bg-cad-panel border-t border-cad-border">
        <div className="relative group bg-white dark:bg-[#0d1116] border border-cad-border rounded-lg outline-none focus-within:ring-1 focus-within:ring-cad-primary focus-within:border-cad-primary transition-all">
          <textarea
            className="w-full bg-transparent border-0 rounded-lg pl-3 pr-20 py-3 text-sm text-cad-text placeholder-gray-500 focus:ring-0 resize-none min-h-[44px]"
            placeholder={
              selectedAssistant
                ? `Ask ${selectedAssistant.name}...`
                : "Ask AI..."
            }
            rows={2}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <button
              onClick={handleClearChat}
              className="p-1.5 text-cad-muted hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors flex items-center justify-center pointer-events-auto"
              title="Clear Chat"
            >
              <span className="material-symbols-outlined text-[18px]">
                delete
              </span>
            </button>
            <button
              onClick={handleSend}
              disabled={isLoading && !isGenerating}
              className={`p-1.5 ${
                isGenerating
                  ? "text-red-500 hover:bg-red-500/10"
                  : "text-cad-primary hover:bg-cad-primary/10"
              } rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed`}
              title={isGenerating ? "Stop generation" : "Send message"}
            >
              <span className="material-symbols-outlined text-[20px]">
                {isGenerating ? "stop_circle" : "send"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const NavButton = ({
    icon,
    label,
    active,
    onClick,
  }: {
    icon: string;
    label: string;
    active: boolean;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-1 p-2 rounded-lg transition-all w-10 ${active ? "bg-cad-primary/20 text-cad-primary" : "text-gray-500 hover:text-cad-text hover:bg-white/5"}`}
      title={label}
    >
      <span
        className={`material-symbols-outlined text-[20px] ${active ? "filled" : ""}`}
      >
        {icon}
      </span>
    </button>
  );

  // --- COMPONENTS ---
  const ChatMessageItem = (props: { msg: ChatMessage; [key: string]: any }) => {
    const { msg } = props;
    const [copyStatus, setCopyStatus] = useState(false);

    const handleCopyMessage = () => {
      navigator.clipboard.writeText(msg.text);
      setCopyStatus(true);
      setTimeout(() => setCopyStatus(false), 2000);
    };

    return (
      <div
        className={`flex gap-3 ${msg.sender === "user" ? "flex-row-reverse" : ""}`}
      >
        {msg.sender === "ai" && (
          <div className="size-8 rounded-full bg-white dark:bg-[#1e293b] flex items-center justify-center shrink-0 border border-cad-border shadow-sm">
            <span className="material-symbols-outlined text-cad-primary text-[16px]">
              smart_toy
            </span>
          </div>
        )}
        <div
          className={`flex flex-col gap-1 max-w-[85%] ${msg.sender === "user" ? "items-end" : ""}`}
        >
          <div
            className={`group relative p-3 rounded-2xl text-sm leading-relaxed shadow-sm border
                            ${msg.sender === "ai" ? "bg-white dark:bg-[#1e293b] rounded-tl-none border-cad-border text-cad-text" : "bg-cad-primary text-white rounded-tr-none border-transparent"}`}
          >
            {msg.sender === "ai" ? (
              <>
                <MarkdownMessage content={msg.text} />
                <button
                  onClick={handleCopyMessage}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-cad-text rounded border border-cad-border flex items-center gap-1"
                  title="Copy message"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {copyStatus ? "check" : "content_copy"}
                  </span>
                  {copyStatus ? "Copied!" : "Copy"}
                </button>
              </>
            ) : (
              msg.text
            )}
          </div>
        </div>
      </div>
    );
  };

  // --- RENDER ---
  return (
    <div className="flex h-full shrink-0 z-20 shadow-xl shadow-black/50 border-l border-cad-border bg-cad-panel">
      {/* Frame 1: Properties Library (Always visible on large screens, fixed width) */}
      <div className="w-64 border-r border-cad-border flex flex-col relative bg-cad-panel hidden lg:flex flex-shrink-0">
        {renderPropertiesAndStructure()}
      </div>

      {/* Resizable Divider between Properties and Assistant Panel */}
      <div
        className="hidden lg:flex w-1 bg-cad-border hover:bg-cad-primary cursor-col-resize relative z-30 transition-colors flex-shrink-0"
        onMouseDown={handleAssistantResizeStart}
        title="Drag to resize"
      />

      {/* Frame 2: AI / Dynamic Content (Resizable width) */}
      <div
        className={`flex flex-col h-full relative bg-cad-panel transition-all duration-300 ${isPanelCollapsed ? "w-0 overflow-hidden" : "border-l border-cad-border"}`}
        style={isPanelCollapsed ? {} : { width: `${assistantPanelWidth}px` }}
        data-collapsed={isPanelCollapsed}
      >
        {mode === SidePanelMode.LLM_MODELS && renderLLMModels()}
        {mode === SidePanelMode.ASSISTANTS && renderAssistants()}
        {mode === SidePanelMode.CHAT && renderChat()}
        {mode === SidePanelMode.FILES && renderFiles()}
        {mode === SidePanelMode.SETTINGS && renderSettings()}
        {mode === SidePanelMode.USER_INFO && renderUserInfo()}
      </div>

      {/* Navigation Strip */}
      <nav className="w-12 border-l border-cad-border bg-cad-bg dark:bg-[#0d1116] flex flex-col items-center py-4 gap-4 z-40 transition-colors duration-300">
        {/* Panel Toggle Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsPanelCollapsed(!isPanelCollapsed);
          }}
          className="group flex flex-col items-center gap-1 p-2 rounded-lg transition-all w-10 text-gray-500 hover:text-cad-text hover:bg-cad-text/5 relative z-50"
          title={isPanelCollapsed ? "Expand Panel" : "Collapse Panel"}
        >
          <span className="material-symbols-outlined text-[20px]">
            {isPanelCollapsed
              ? "keyboard_double_arrow_right"
              : "keyboard_double_arrow_left"}
          </span>
        </button>

        <div className="w-8 h-px bg-cad-border shrink-0"></div>

        <NavButton
          icon="deployed_code"
          label="LLM Models"
          active={mode === SidePanelMode.LLM_MODELS}
          onClick={() => {
            setIsPanelCollapsed(false);
            onChangeMode(SidePanelMode.LLM_MODELS);
          }}
        />
        <NavButton
          icon="group"
          label="Assistants"
          active={mode === SidePanelMode.ASSISTANTS}
          onClick={() => {
            setIsPanelCollapsed(false);
            onChangeMode(SidePanelMode.ASSISTANTS);
          }}
        />
        <NavButton
          icon="chat"
          label="Dialogue"
          active={mode === SidePanelMode.CHAT}
          onClick={() => {
            setIsPanelCollapsed(false);
            onChangeMode(SidePanelMode.CHAT);
          }}
        />
        <NavButton
          icon="folder_open"
          label="Files"
          active={mode === SidePanelMode.FILES}
          onClick={() => {
            setIsPanelCollapsed(false);
            onChangeMode(SidePanelMode.FILES);
          }}
        />

        <div className="flex-1"></div>
        <NavButton
          icon="settings"
          label="Settings"
          active={mode === SidePanelMode.SETTINGS}
          onClick={() => {
            setIsPanelCollapsed(false);
            onChangeMode(SidePanelMode.SETTINGS);
          }}
        />
        {currentUser ? (
          <div
            onClick={() => {
              setIsPanelCollapsed(false);
              onChangeMode(SidePanelMode.USER_INFO);
              onShowUserProfile?.();
            }}
            className="size-8 rounded-full bg-gradient-to-br from-[#137fec] to-[#0b63c1] flex items-center justify-center text-[10px] font-bold text-white cursor-pointer mt-2 hover:scale-105 transition-transform"
            title="Click to view profile"
          >
            {currentUser.username?.substring(0, 2).toUpperCase()}
          </div>
        ) : (
          <div
            className="size-8 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] font-bold text-white cursor-pointer mt-2"
            title="Not logged in"
          >
            U
          </div>
        )}
      </nav>
    </div>
  );
};
