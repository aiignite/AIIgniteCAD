import React, { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "./components/Header";
import { Toolbar } from "./components/Toolbar";
import { Canvas } from "./components/Canvas";
import { RightPanel } from "./components/RightPanel";
import { Footer } from "./components/Footer";
import { LoginPage } from "./components/LoginPage";
import { RegisterPage } from "./components/RegisterPage";
import {
  ToolType,
  SidePanelMode,
  CADElement,
  Point,
  DrawingSettings,
  ProjectFile,
} from "./types";
import {
  apiService,
} from "./services/apiService";
import { indexedDBService } from "./services/indexedDBService";
import * as Transform from "./lib/transform";

function App() {
  const startupRef = useRef(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [activeTool, setActiveTool] = useState<ToolType>(ToolType.SELECT);
  const [sideMode, setSideMode] = useState<SidePanelMode>(SidePanelMode.CHAT);

  // Initial State
  const initialElements: CADElement[] = [
    {
      id: "init-1",
      type: "LINE",
      start: { x: 100, y: 100 },
      end: { x: 700, y: 100 },
      layer: "0",
      color: "#8b949e",
    },
    {
      id: "init-2",
      type: "LINE",
      start: { x: 700, y: 100 },
      end: { x: 700, y: 500 },
      layer: "0",
      color: "#8b949e",
    },
    {
      id: "init-3",
      type: "LINE",
      start: { x: 700, y: 500 },
      end: { x: 100, y: 500 },
      layer: "0",
      color: "#8b949e",
    },
    {
      id: "init-4",
      type: "LINE",
      start: { x: 100, y: 500 },
      end: { x: 100, y: 100 },
      layer: "0",
      color: "#8b949e",
    },
  ];

  const [elements, setElements] = useState<CADElement[]>(initialElements);

  // --- FILE MANAGEMENT ---
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activeFile, setActiveFile] = useState<ProjectFile | null>(null);

  // --- DRAWING SETTINGS (Coordinate System & Dimensions) ---
  const [drawingSettings, setDrawingSettings] = useState<DrawingSettings>({
    units: "mm",
    gridSpacing: 50,
    snapDistance: 10,
    dimScale: 1.0,
    dimPrecision: 2,
  });

  // --- HISTORY STATE (Undo/Redo) ---
  const [history, setHistory] = useState<CADElement[][]>([initialElements]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // --- DRAWING AIDS STATE ---
  const [orthoMode, setOrthoMode] = useState(false);
  const [snapMode, setSnapMode] = useState(true);
  const [gridMode, setGridMode] = useState(true);

  // --- UI STATE ---
  const [notification, setNotification] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showTextModal, setShowTextModal] = useState(false);
  const [textInputPos, setTextInputPos] = useState<Point | null>(null);
  const [textInputValue, setTextInputValue] = useState("");

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // Load user and projects on mount
  useEffect(() => {
    const init = async () => {
      try {
        await indexedDBService.init();

        if (apiService.isAuthenticated()) {
          await loadUserAndProjects();
        } else {
          const localProjects = await indexedDBService.getAllProjects();
          setFiles(localProjects);
        }
      } catch (e) {
        console.error("Initialization error:", e);
      }
    };
    init();
  }, []);

  // Startup: Automatically create a new file if none exists or active
  useEffect(() => {
    if (!startupRef.current && !loading) {
      startupRef.current = true;
      if (!activeFile) {
        handleCreateFile(`Drawing-${Math.floor(Math.random() * 10000)}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, activeFile]);

  const loadUserAndProjects = async () => {
    try {
      setLoading(true);
      const userData = await apiService.getCurrentUser();
      setCurrentUser(userData.user);

      const projectsData = await apiService.getProjects();
      setFiles(projectsData.projects);
      setIsLoggedIn(true);
    } catch (error) {
      console.error("Failed to load user data:", error);
      apiService.clearToken();
      setIsLoggedIn(false);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (email: string, password: string) => {
    try {
      setLoading(true);
      const data = await apiService.login(email, password);
      setCurrentUser(data.user);
      await loadUserAndProjects();
    } catch (error: any) {
      showNotification(error.message || "Login failed");
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (
    username: string,
    email: string,
    password: string,
  ) => {
    try {
      setLoading(true);
      const data = await apiService.register(username, email, password);
      setCurrentUser(data.user);
      await loadUserAndProjects();
    } catch (error: any) {
      showNotification(error.message || "Registration failed");
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiService.logout();
      setCurrentUser(null);
      setFiles([]);
      setIsLoggedIn(false);
      showNotification("Logged out successfully");
    } catch (error: any) {
      console.error("Logout error:", error);
    }
  };

  const handleShowUserProfile = () => {
    setSideMode(SidePanelMode.USER_INFO);
  };

  // --- HISTORY LOGIC ---
  // Called whenever an action completes (MouseUp after draw, Property Change, etc.)
  const recordHistory = useCallback(
    (newElements: CADElement[]) => {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newElements);

      // Optional: Limit history size to prevent memory issues
      if (newHistory.length > 50) newHistory.shift();

      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [history, historyIndex],
  );

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setElements(history[newIndex]);
      showNotification("Undo");
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setElements(history[newIndex]);
      showNotification("Redo");
    }
  }, [history, historyIndex]);

  // Used by children components to trigger a "checkpoint" using the current state of 'elements'
  // BUT since 'elements' in this scope might be stale if called from child,
  // we usually pass the *new* state from the child to this function.
  const commitAction = (finalElements: CADElement[]) => {
    setElements(finalElements); // Update display
    recordHistory(finalElements); // Save snapshot
  };

  // --- KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if (
        ((e.ctrlKey || e.metaKey) && e.key === "y") ||
        ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey)
      ) {
        e.preventDefault();
        handleRedo();
      }
      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        if (
          activeTool === ToolType.SELECT &&
          document.activeElement === document.body
        ) {
          const newEls = elements.filter((el) => !el.selected);
          if (newEls.length !== elements.length) {
            commitAction(newEls);
          }
        }
      }
      // Escape to cancel tools
      if (e.key === "Escape") {
        if (activeTool !== ToolType.SELECT) {
          setActiveTool(ToolType.SELECT);
          showNotification("Cancelled");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, activeTool, elements, commitAction]);

  // --- COMMAND LINE HANDLING ---
  const handleCommand = (cmd: string) => {
    const normalizedCmd = cmd.trim().toUpperCase();

    // Tool Mapping
    switch (normalizedCmd) {
      case "L":
      case "LINE":
        setActiveTool(ToolType.LINE);
        showNotification("Tool: LINE");
        break;
      case "C":
      case "CIRCLE":
        setActiveTool(ToolType.CIRCLE);
        showNotification("Tool: CIRCLE");
        break;
      case "R":
      case "REC":
      case "RECTANGLE":
        setActiveTool(ToolType.RECTANGLE);
        showNotification("Tool: RECTANGLE");
        break;
      case "PL":
      case "POLYLINE":
        setActiveTool(ToolType.POLYLINE);
        showNotification("Tool: POLYLINE");
        break;
      case "A":
      case "ARC":
        setActiveTool(ToolType.ARC);
        showNotification("Tool: ARC");
        break;
      case "T":
      case "TEXT":
        setActiveTool(ToolType.TEXT);
        showNotification("Tool: TEXT");
        break;

      // Modification Tools
      case "M":
      case "MOVE":
        setActiveTool(ToolType.SELECT); // Move is implicitly select+drag
        showNotification("Mode: MOVE/SELECT");
        break;
      case "CO":
      case "CP":
      case "COPY":
        setActiveTool(ToolType.COPY);
        showNotification("Tool: COPY");
        break;
      case "TR":
      case "TRIM":
        setActiveTool(ToolType.TRIM);
        showNotification("Tool: TRIM");
        break;
      case "MI":
      case "MIRROR":
        setActiveTool(ToolType.MIRROR);
        showNotification("Tool: MIRROR");
        break;
      case "RO":
      case "ROTATE":
        setActiveTool(ToolType.ROTATE);
        showNotification("Tool: ROTATE");
        break;
      case "E":
      case "DEL":
      case "ERASE":
        const newEls = elements.filter((el) => !el.selected);
        if (newEls.length !== elements.length) {
          commitAction(newEls);
          showNotification("Deleted selected objects");
        } else {
          showNotification("Select objects to erase");
        }
        break;

      // Dimensions
      case "D":
      case "DIM":
      case "DIMENSION":
        setActiveTool(ToolType.DIMENSION);
        showNotification("Tool: DIMENSION");
        break;
      case "DI":
      case "DIST":
      case "MEASURE":
        setActiveTool(ToolType.MEASURE);
        showNotification("Tool: MEASURE");
        break;

      // Settings
      case "ORTHO":
        setOrthoMode((prev) => {
          showNotification(`ORTHO: ${!prev ? "ON" : "OFF"}`);
          return !prev;
        });
        break;
      case "GRID":
        setGridMode((prev) => {
          showNotification(`GRID: ${!prev ? "ON" : "OFF"}`);
          return !prev;
        });
        break;
      case "SNAP":
        setSnapMode((prev) => {
          showNotification(`SNAP: ${!prev ? "ON" : "OFF"}`);
          return !prev;
        });
        break;

      default:
        showNotification(`Unknown command: ${normalizedCmd}`);
    }
  };

  // --- EVENT HANDLERS ---

  const handleAddElement = (el: CADElement) => {
    const newEls = [...elements, el];
    commitAction(newEls);
  };

  const handleUpdateElement = (updatedEl: CADElement) => {
    const newEls = elements.map((el) =>
      el.id === updatedEl.id ? updatedEl : el,
    );
    setElements(newEls); // Just visual update, wait for 'commit' for history if it's dragging
  };

  const handleBulkUpdate = (updatedElements: CADElement[]) => {
    const updates = new Map(updatedElements.map((e) => [e.id, e]));
    const newEls = elements.map((el) =>
      updates.has(el.id) ? updates.get(el.id)! : el,
    );
    setElements(newEls);
  };

  const handleImport = (importedElements: CADElement[]) => {
    commitAction(importedElements);
  };

  const handleAIAction = (
    operation: string,
    aiElements?: CADElement[],
    params?: any,
  ) => {
    if (operation === "CLEAR") {
      commitAction([]);
    } else if (operation === "DELETE_LAST") {
      commitAction(elements.slice(0, -1));
    } else if (operation === "ADD" && aiElements) {
      commitAction([...elements, ...aiElements]);
    } else if (operation === "COPY") {
      // 1. Identify "Source" elements
      // If AI provided elements, map them to current canvas elements to get full state
      // If no AI elements, use selection or all
      let sourceElements: CADElement[] = [];
      
      if (aiElements && aiElements.length > 0) {
        sourceElements = aiElements.map(t => elements.find(e => e.id === t.id) || t);
      } else {
        const selected = elements.filter((el) => el.selected);
        sourceElements = selected.length > 0 ? selected : elements;
      }

      if (sourceElements.length > 0) {
        // 2. Determine offset
        // If param is provided, use it. If not, default to 50,50 to verify user sees the copy
        const dx = params?.dx ?? 50;
        const dy = params?.dy ?? 50;

        // 3. Perform Copy
        const copied = Transform.copyElements(sourceElements, { x: dx, y: dy });

        // 4. CRITICAL: Assign NEW IDs to all copied elements to avoid collision
        const finalCopied = copied.map(el => ({
          ...el,
          id: `copy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          selected: true
        }));

        // 5. Commit: Unselect originals, add copies
        commitAction([...elements.map((el) => ({ ...el, selected: false })), ...finalCopied]);
      }
    } else if (operation === "MOVE") {
      const selected = elements.filter((el) => el.selected);
      // 优先使用 AI 提供的元素，其次是选中的，最后是全部
      const rawTargets = (aiElements && aiElements.length > 0) ? aiElements : (selected.length > 0 ? selected : elements);
      
      // 解析目标元素 (如果 AI 提供了 ID 匹配的，或者是选中的)
      const targets = rawTargets.map(t => elements.find(e => e.id === t.id) || t);

      if (targets.length > 0) {
        const dx = params?.dx ?? params?.x ?? 0;
        const dy = params?.dy ?? params?.y ?? 0;

        if (dx !== 0 || dy !== 0) {
            // 通过偏移量移动
            const moved = Transform.moveElements(targets, { x: dx, y: dy });
            const updates = new Map(moved.map((e) => [e.id, e]));
            const newEls = elements.map((el) => updates.has(el.id) ? updates.get(el.id)! : el);
            const existingIds = new Set(elements.map(e => e.id));
            const brandNew = moved.filter(e => !existingIds.has(e.id));
            commitAction([...newEls, ...brandNew]);
        } else if (aiElements && aiElements.length > 0) {
            // AI 提供了最终位置的元素，且没有偏移量参数
            const updates = new Map(aiElements.map((e) => [e.id, e]));
            const newEls = elements.map((el) => updates.has(el.id) ? { ...el, ...updates.get(el.id)! } : el);
            const existingIds = new Set(elements.map(e => e.id));
            const brandNew = aiElements.filter(e => !existingIds.has(e.id));
            commitAction([...newEls, ...brandNew]);
        }
      }
    } else if (operation === "ROTATE") {
      const selected = elements.filter((el) => el.selected);
      const rawTargets = (aiElements && aiElements.length > 0) ? aiElements : (selected.length > 0 ? selected : elements);
      const targets = rawTargets.map(t => elements.find(e => e.id === t.id) || t);
      
      if (targets.length > 0) {
        const angle = params?.angle ?? 90;
        const center = params?.center || Transform.getElementsCentroid(targets);
        const rotated = Transform.rotateElements(targets, center, angle);
        
        const updates = new Map(rotated.map((e) => [e.id, e]));
        const newEls = elements.map((el) => updates.has(el.id) ? updates.get(el.id)! : el);
        const existingIds = new Set(elements.map(e => e.id));
        const brandNew = rotated.filter(e => !existingIds.has(e.id));
        commitAction([...newEls, ...brandNew]);
      }
    } else if (operation === "MIRROR") {
      const selected = elements.filter((el) => el.selected);
      const rawTargets = (aiElements && aiElements.length > 0) ? aiElements : (selected.length > 0 ? selected : elements);
      const targets = rawTargets.map(t => elements.find(e => e.id === t.id) || t);
      
      if (targets.length > 0) {
        const p1 = params?.p1 || { x: 400, y: 0 };
        const p2 = params?.p2 || { x: 400, y: 600 };
        // 镜像逻辑：默认创建新元素（副本）
        const mirrored = Transform.mirrorElements(targets, { start: p1, end: p2 }).map(el => ({
          ...el,
          id: Math.random().toString(36).substr(2, 9),
          selected: true
        }));
        commitAction([...elements.map((el) => ({ ...el, selected: false })), ...mirrored]);
      }
    }        // Since we resolved by ID, we are modifying unless 'mirrored' contains new IDs.
        // But 'Transform.mirrorElements' returns elements with SAME IDs as input.
        // So default is Modify. If Copy is desired, AI should use COPY operation with Mirror transform? 
        // Or we assume "MIRROR" means Modify.
        
        const updates = new Map(mirrored.map((e) => [e.id, e]));
        const newEls = elements.map((el) => updates.has(el.id) ? updates.get(el.id)! : el);
        const existingIds = new Set(elements.map(e => e.id));
        const brandNew = mirrored.filter(e => !existingIds.has(e.id));
        commitAction([...newEls, ...brandNew]);
      }
    }
  };

  // Text Tool Logic
  const handleRequestTextEntry = (pos: Point) => {
    setTextInputPos(pos);
    setTextInputValue("");
    setShowTextModal(true);
  };

  const confirmTextEntry = () => {
    if (textInputValue && textInputPos) {
      const uid = Math.random().toString(36).substr(2, 9);
      const newEl: CADElement = {
        id: uid,
        type: "TEXT",
        layer: "0",
        color: "#cad-text",
        start: textInputPos,
        text: textInputValue,
        fontSize: 12,
      };
      handleAddElement(newEl);
    }
    setShowTextModal(false);
    setActiveTool(ToolType.SELECT);
  };

  const handleSave = useCallback(async () => {
    if (!activeFile) return;

    try {
      const updatedFile = {
        ...activeFile,
        elements,
        lastModified: new Date().toISOString(),
        elementCount: elements.length,
      };

      // Save locally
      await indexedDBService.saveProject(updatedFile);
      await indexedDBService.saveElements(elements, activeFile.id);

      // Save remotely if logged in
      if (apiService.isAuthenticated()) {
        await apiService.updateProject(activeFile.id, {
          name: updatedFile.name,
        });
        await apiService.saveProjectElements(activeFile.id, elements);
      }

      setFiles((prev) =>
        prev.map((f) => (f.id === activeFile.id ? updatedFile : f))
      );
      setActiveFile(updatedFile);
      showNotification("Saved successfully");
    } catch (error: any) {
      showNotification("Save failed: " + error.message);
    }
  }, [activeFile, elements]);

  // Auto-save effect
  useEffect(() => {
    if (!activeFile) return;

    const timer = setTimeout(async () => {
      try {
        const updatedFile = {
          ...activeFile,
          elements,
          lastModified: new Date().toISOString(),
          elementCount: elements.length,
        };
        await indexedDBService.saveProject(updatedFile);
        await indexedDBService.saveElements(elements, activeFile.id);

        if (apiService.isAuthenticated()) {
          await apiService.saveProjectElements(activeFile.id, elements);
        }
      } catch (e) {
        console.error("Auto-save failed", e);
      }
    }, 3000); // 3 seconds delay

    return () => clearTimeout(timer);
  }, [elements, activeFile]);

  const handleLoadFile = async (file: ProjectFile) => {
    if (activeFile && activeFile.id === file.id) return;

    try {
      // Save current work before loading another file
      if (activeFile && elements.length > 0) {
        const updatedFile = {
          ...activeFile,
          elements,
          lastModified: new Date().toISOString(),
          elementCount: elements.length,
        };
        await indexedDBService.saveProject(updatedFile);
        await indexedDBService.saveElements(elements, activeFile.id);
        if (apiService.isAuthenticated()) {
          await apiService.saveProjectElements(activeFile.id, elements);
        }
      }

      let loadedElements: CADElement[] = [];

      if (apiService.isAuthenticated()) {
        await apiService.openProject(file.id);
        const projectData = await apiService.getProject(file.id);
        // Map backend elements back to CADElement
        loadedElements =
          (projectData.project.elements || []).map((el: any) => ({
            ...el.geometryData,
          })) || [];
      } else {
        // Load from local DB
        loadedElements = await indexedDBService.getElementsByProject(file.id);
      }

      setElements(loadedElements);
      setHistory([loadedElements]);
      setHistoryIndex(0);
      setActiveFile(file);
      showNotification(`Loaded ${file.name}`);
    } catch (error: any) {
      showNotification(error.message || "Failed to load file");
    }
  };

  const handleCreateFile = async (name: string) => {
    try {
      let newFile: ProjectFile;

      if (apiService.isAuthenticated()) {
        const data = await apiService.createProject(name);
        newFile = {
          id: data.project.id,
          name: data.project.name,
          lastModified: data.project.createdAt,
          elementCount: 0,
          elements: [],
        };
      } else {
        // Local create
        newFile = {
          id: Math.random().toString(36).substr(2, 9),
          name: name,
          lastModified: new Date().toISOString(),
          elementCount: 0,
          elements: [],
        };
        await indexedDBService.saveProject(newFile);
      }

      setFiles((prev) => [newFile, ...prev]);
      setActiveFile(newFile);
      setElements([]);
      setHistory([[]]);
      setHistoryIndex(0);
      showNotification(`Created ${name}`);
    } catch (error: any) {
      showNotification(error.message || "Failed to create file");
    }
  };

  const handleRenameFile = async (id: string, newName: string) => {
    try {
      if (apiService.isAuthenticated()) {
        await apiService.updateProject(id, { name: newName });
      }

      // Always update local/DB
      const project = await indexedDBService.getProject(id);
      if (project) {
        await indexedDBService.saveProject({ ...project, name: newName });
      }

      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, name: newName } : f)),
      );

      // Update active file if it's the one being renamed
      if (activeFile && activeFile.id === id) {
        setActiveFile({ ...activeFile, name: newName });
      }

      showNotification("File renamed");
    } catch (error: any) {
      showNotification(error.message || "Failed to rename file");
    }
  };

  const handleDeleteFile = async (id: string) => {
    try {
      if (apiService.isAuthenticated()) {
        await apiService.deleteProject(id);
      }

      // Always delete from local DB
      await indexedDBService.deleteProject(id);

      setFiles((prev) => prev.filter((f) => f.id !== id));

      if (activeFile && activeFile.id === id) {
        setActiveFile(null);
      }

      showNotification("File deleted");
    } catch (error: any) {
      showNotification(error.message || "Failed to delete file");
    }
  };

  if (!isLoggedIn) {
    if (authMode === "register") {
      return (
        <RegisterPage
          onRegister={handleRegister}
          loading={loading}
          onBackToLogin={() => setAuthMode("login")}
        />
      );
    }
    return (
      <LoginPage
        onLogin={handleLogin}
        loading={loading}
        onRegisterClick={() => setAuthMode("register")}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-cad-bg text-cad-text font-display relative">
      {/* TEXT INPUT MODAL */}
      {showTextModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
          <div className="bg-cad-panel border border-cad-border p-4 rounded-lg shadow-xl w-80 animate-in zoom-in-95 duration-200">
            <h3 className="text-sm font-bold mb-3">Enter Text</h3>
            <input
              autoFocus
              className="w-full bg-white dark:bg-black/20 border border-cad-border rounded px-2 py-1.5 text-sm mb-4 outline-none focus:border-cad-primary"
              value={textInputValue}
              onChange={(e) => setTextInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmTextEntry()}
              placeholder="Type here..."
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowTextModal(false)}
                className="px-3 py-1.5 text-xs text-cad-muted hover:bg-cad-border/50 rounded"
              >
                Cancel
              </button>
              <button
                onClick={confirmTextEntry}
                className="px-3 py-1.5 text-xs bg-cad-primary text-white rounded hover:bg-cad-primaryHover"
              >
                Add Text
              </button>
            </div>
          </div>
        </div>
      )}

      {notification && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-4 fade-in duration-300">
          <div className="bg-cad-panel/90 border border-cad-primary/50 text-cad-text px-4 py-2 rounded-lg shadow-lg shadow-black/20 flex items-center gap-2 backdrop-blur-sm">
            <span className="material-symbols-outlined text-cad-primary text-[20px]">
              info
            </span>
            <span className="text-sm font-medium">{notification}</span>
          </div>
        </div>
      )}

      <Header
        elements={elements}
        onImport={handleImport}
        onUndo={handleUndo}
        onRedo={handleRedo}
        currentUser={currentUser}
        onLogout={handleLogout}
        fileName={activeFile?.name}
        onSave={handleSave}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <Toolbar activeTool={activeTool} onToolSelect={setActiveTool} />
        <Canvas
          elements={elements}
          activeTool={activeTool}
          onAddElement={handleAddElement}
          onUpdateElement={handleUpdateElement}
          onBulkUpdate={handleBulkUpdate}
          setElements={setElements}
          onCommitAction={commitAction}
          onRequestTextEntry={handleRequestTextEntry}
          drawingSettings={drawingSettings}
          orthoMode={orthoMode}
          snapMode={snapMode}
          gridMode={gridMode}
          onNotification={showNotification}
        />
        <RightPanel
          mode={sideMode}
          onChangeMode={setSideMode}
          currentElements={elements}
          drawingSettings={drawingSettings}
          onUpdateSettings={setDrawingSettings}
          onUpdateElement={(el) => {
            handleUpdateElement(el);
            commitAction(elements.map((e) => (e.id === el.id ? el : e)));
          }}
          onApplyAIAction={handleAIAction}
          files={files}
          activeFileId={activeFile?.id || null}
          onLoadFile={handleLoadFile}
          onCreateFile={handleCreateFile}
          onRenameFile={handleRenameFile}
          onDeleteFile={handleDeleteFile}
          currentUser={currentUser}
          onLogout={handleLogout}
          onShowUserProfile={handleShowUserProfile}
        />
      </div>
      <Footer
        orthoMode={orthoMode}
        toggleOrtho={() => setOrthoMode(!orthoMode)}
        snapMode={snapMode}
        toggleSnap={() => setSnapMode(!snapMode)}
        gridMode={gridMode}
        toggleGrid={() => setGridMode(!gridMode)}
        onCommand={handleCommand}
      />
    </div>
  );
}

export default App;
