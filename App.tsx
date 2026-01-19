import React, { useState, useEffect, useCallback } from "react";
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
import { apiService } from "./services/apiService";

function App() {
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
    if (apiService.isAuthenticated()) {
      loadUserAndProjects();
    }
  }, []);

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

  const handleAIAction = (operation: string, aiElements?: CADElement[]) => {
    if (operation === "CLEAR") {
      commitAction([]);
    } else if (operation === "DELETE_LAST") {
      commitAction(elements.slice(0, -1));
    } else if (operation === "ADD" && aiElements) {
      commitAction([...elements, ...aiElements]);
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

  // File Management Logic
  const handleLoadFile = async (file: ProjectFile) => {
    try {
      await apiService.openProject(file.id);
      const projectData = await apiService.getProject(file.id);
      if (projectData.project.elements) {
        commitAction(projectData.project.elements);
      } else {
        commitAction([]);
      }
      showNotification(`Loaded ${file.name}`);
    } catch (error: any) {
      showNotification(error.message || "Failed to load file");
    }
  };

  const handleCreateFile = async (name: string) => {
    try {
      const data = await apiService.createProject(name);
      const newFile: ProjectFile = {
        id: data.project.id,
        name: data.project.name,
        lastModified: data.project.createdAt,
        elementCount: 0,
      };
      setFiles((prev) => [newFile, ...prev]);
      commitAction([]);
      showNotification(`Created ${name}`);
    } catch (error: any) {
      showNotification(error.message || "Failed to create file");
    }
  };

  const handleRenameFile = async (id: string, newName: string) => {
    try {
      await apiService.updateProject(id, { name: newName });
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, name: newName } : f)),
      );
      showNotification("File renamed");
    } catch (error: any) {
      showNotification(error.message || "Failed to rename file");
    }
  };

  const handleDeleteFile = async (id: string) => {
    try {
      await apiService.deleteProject(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
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
          onCommitAction={commitAction} // For drag-end history save
          onRequestTextEntry={handleRequestTextEntry} // Trigger Modal
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
          // File props
          files={files}
          onLoadFile={handleLoadFile}
          onCreateFile={handleCreateFile}
          onRenameFile={handleRenameFile}
          onDeleteFile={handleDeleteFile}
          // User props
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
