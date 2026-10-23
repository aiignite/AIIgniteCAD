/**
 * appStore.tsx — 应用全局状态管理
 * 管理用户认证、文件、UI 面板、通知等状态
 */

import React, { createContext, useContext, useReducer, useCallback, ReactNode } from "react";
import { SidePanelMode, ProjectFile } from "../types";
import { readUIPreferences, writeUIPreferences } from "../lib/uiPreferences";

/* ─── State ─────────────────────────────────────────────────── */

export interface AppState {
  isLoggedIn: boolean;
  currentUser: any | null;
  files: ProjectFile[];
  activeFile: ProjectFile | null;
  sideMode: SidePanelMode;
  /** 右侧面板是否展开；默认收起，把画布面积让给绘图 */
  sidePanelOpen: boolean;
  loading: boolean;
  notification: string | null;
}

const initialState: AppState = {
  isLoggedIn: false,
  currentUser: null,
  files: [],
  activeFile: null,
  sideMode: SidePanelMode.REVIEW,
  // 面板展开状态持久化，刷新后保持上次的布局
  sidePanelOpen: readUIPreferences().sidePanelOpen,
  loading: false,
  notification: null,
};

/* ─── Actions ──────────────────────────────────────────────── */

export type AppAction =
  | { type: "SET_LOGGED_IN"; value: boolean }
  | { type: "SET_CURRENT_USER"; user: any | null }
  | { type: "SET_FILES"; files: ProjectFile[] }
  | { type: "SET_ACTIVE_FILE"; file: ProjectFile | null }
  | { type: "UPDATE_FILE"; file: ProjectFile }
  | { type: "SET_SIDE_MODE"; mode: SidePanelMode }
  | { type: "SET_SIDE_PANEL_OPEN"; value: boolean }
  | { type: "SET_LOADING"; value: boolean }
  | { type: "SHOW_NOTIFICATION"; message: string }
  | { type: "CLEAR_NOTIFICATION" }
  | { type: "RESET" };

/* ─── Reducer ──────────────────────────────────────────────── */

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_LOGGED_IN":
      return { ...state, isLoggedIn: action.value };

    case "SET_CURRENT_USER":
      return { ...state, currentUser: action.user };

    case "SET_FILES":
      return { ...state, files: action.files };

    case "SET_ACTIVE_FILE":
      return { ...state, activeFile: action.file };

    case "UPDATE_FILE": {
      const updatedFiles = state.files.map((f) =>
        f.id === action.file.id ? action.file : f
      );
      return {
        ...state,
        files: updatedFiles,
        activeFile: state.activeFile?.id === action.file.id ? action.file : state.activeFile,
      };
    }

    case "SET_SIDE_MODE":
      return { ...state, sideMode: action.mode };

    case "SET_SIDE_PANEL_OPEN":
      return { ...state, sidePanelOpen: action.value };

    case "SET_LOADING":
      return { ...state, loading: action.value };

    case "SHOW_NOTIFICATION":
      return { ...state, notification: action.message };

    case "CLEAR_NOTIFICATION":
      return { ...state, notification: null };

    case "RESET":
      return { ...initialState };

    default:
      return state;
  }
}

/* ─── Context ───────────────────────────────────────────────── */

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  setLoggedIn: (value: boolean) => void;
  setCurrentUser: (user: any | null) => void;
  setFiles: (files: ProjectFile[]) => void;
  setActiveFile: (file: ProjectFile | null) => void;
  updateFile: (file: ProjectFile) => void;
  setSideMode: (mode: SidePanelMode) => void;
  setSidePanelOpen: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  showNotification: (message: string) => void;
  clearNotification: () => void;
  resetApp: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/* ─── Provider ──────────────────────────────────────────────── */

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const setLoggedIn = useCallback(
    (value: boolean) => dispatch({ type: "SET_LOGGED_IN", value }),
    []
  );

  const setCurrentUser = useCallback(
    (user: any | null) => dispatch({ type: "SET_CURRENT_USER", user }),
    []
  );

  const setFiles = useCallback(
    (files: ProjectFile[]) => dispatch({ type: "SET_FILES", files }),
    []
  );

  const setActiveFile = useCallback(
    (file: ProjectFile | null) => dispatch({ type: "SET_ACTIVE_FILE", file }),
    []
  );

  const updateFile = useCallback(
    (file: ProjectFile) => dispatch({ type: "UPDATE_FILE", file }),
    []
  );

  const setSideMode = useCallback(
    (mode: SidePanelMode) => dispatch({ type: "SET_SIDE_MODE", mode }),
    []
  );

  const setSidePanelOpen = useCallback(
    (value: boolean) => {
      dispatch({ type: "SET_SIDE_PANEL_OPEN", value });
      writeUIPreferences({ sidePanelOpen: value });
    },
    []
  );

  const setLoading = useCallback(
    (value: boolean) => dispatch({ type: "SET_LOADING", value }),
    []
  );

  const showNotification = useCallback(
    (message: string) => dispatch({ type: "SHOW_NOTIFICATION", message }),
    []
  );

  const clearNotification = useCallback(
    () => dispatch({ type: "CLEAR_NOTIFICATION" }),
    []
  );

  const resetApp = useCallback(() => dispatch({ type: "RESET" }), []);

  const value: AppContextValue = {
    state,
    dispatch,
    setLoggedIn,
    setCurrentUser,
    setFiles,
    setActiveFile,
    updateFile,
    setSideMode,
    setSidePanelOpen,
    setLoading,
    showNotification,
    clearNotification,
    resetApp,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/* ─── Hook ──────────────────────────────────────────────────── */

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within an AppProvider");
  return ctx;
}
