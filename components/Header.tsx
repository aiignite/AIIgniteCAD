import React, { useRef, useState, useEffect } from "react";
import { exportToDXF, parseDXF } from "../services/dxfService";
import { CADElement } from "../types";

interface HeaderProps {
  elements: CADElement[];
  onImport: (elements: CADElement[]) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  currentUser?: any;
  onLogout?: () => Promise<void>;
  fileName?: string;
  onSave?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  elements,
  onImport,
  onUndo,
  onRedo,
  currentUser,
  onLogout,
  fileName = "Untitled.dxf",
  onSave,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    if (document.documentElement.classList.contains("dark")) {
      document.documentElement.classList.remove("dark");
      setIsDark(false);
    } else {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    }
  };

  const handleExport = () => {
    const dxfContent = exportToDXF(elements);
    const blob = new Blob([dxfContent], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drawing-${Date.now()}.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        const imported = parseDXF(text);
        onImport(imported);
      };
      reader.readAsText(file);
    }
  };

  return (
    <header className="flex items-center justify-between whitespace-nowrap border-b border-cad-border bg-cad-bg pl-2 pr-4 h-14 shrink-0 z-30 shadow-sm transition-colors duration-300">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".dxf"
        onChange={handleFileChange}
      />

      <div className="flex items-center gap-3">
        <div className="size-10 shrink-0">
          <svg
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full drop-shadow-md"
          >
            <defs>
              <linearGradient
                id="cad-bg-gradient"
                x1="0"
                y1="0"
                x2="200"
                y2="200"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#137fec" />
                <stop offset="100%" stopColor="#0b63c1" />
              </linearGradient>

              <radialGradient
                id="cad-halo-gradient"
                cx="100"
                cy="110"
                r="60"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="20%" stopColor="white" stopOpacity="0.3" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </radialGradient>

              <mask id="cad-fire-mask">
                <path
                  d="M100 142 C 78 142, 70 115, 88 92 C 98 80, 115 65, 105 40 C 128 65, 138 100, 122 128 C 115 140, 110 142, 100 142Z"
                  fill="white"
                />
                <path
                  d="M101 142 C 94 130, 92 115, 96 100 C 100 85, 108 75, 106 40 H 102 C 104 75, 96 85, 92 100 C 88 115, 90 130, 97 142 Z"
                  fill="black"
                />
              </mask>
            </defs>

            <rect
              width="200"
              height="200"
              rx="40"
              fill="url(#cad-bg-gradient)"
            />

            <path
              d="M100 148 C 65 148, 55 115, 80 85 C 95 65, 125 55, 105 25 C 135 55, 150 95, 130 125 C 120 142, 115 148, 100 148Z"
              fill="url(#cad-halo-gradient)"
            />

            <path
              d="M100 142 C 78 142, 70 115, 88 92 C 98 80, 115 65, 105 40 C 128 65, 138 100, 122 128 C 115 140, 110 142, 100 142Z"
              fill="white"
              mask="url(#cad-fire-mask)"
            />

            <g>
              <path
                d="M 70 165 H 130"
                stroke="#E0F2FE"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <path
                d="M 70 161 V 169"
                stroke="#E0F2FE"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <path
                d="M 130 161 V 169"
                stroke="#E0F2FE"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <rect
                x="94"
                y="159"
                width="12"
                height="12"
                stroke="#E0F2FE"
                strokeWidth="2"
                fill="none"
                strokeLinejoin="round"
              />
            </g>

            <circle cx="100.5" cy="138" r="3" fill="white" />
          </svg>
        </div>

        <div className="flex items-baseline gap-2">
          <h2 className="text-cad-text text-lg font-bold leading-none tracking-tight font-display">
            AI Ignite CAD
          </h2>
          <span className="text-[10px] text-cad-muted font-mono transform translate-y-[-1px]">
            {fileName}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1 text-cad-muted">
          <button
            onClick={onUndo}
            className="p-1.5 hover:text-cad-text hover:bg-cad-text/10 rounded transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <span className="material-symbols-outlined text-[20px]">undo</span>
          </button>
          <button
            onClick={onRedo}
            className="p-1.5 hover:text-cad-text hover:bg-cad-text/10 rounded transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <span className="material-symbols-outlined text-[20px]">redo</span>
          </button>
        </div>

        <div className="h-5 w-px bg-cad-border"></div>

        <button
          onClick={onSave}
          className="text-cad-muted hover:text-cad-text text-xs font-medium px-2 transition-colors"
        >
          Save
        </button>

        <button
          onClick={handleImportClick}
          className="text-cad-muted hover:text-cad-text text-xs font-medium px-2 transition-colors"
        >
          Import
        </button>

        <button
          onClick={handleExport}
          className="hidden sm:flex items-center gap-2 h-8 px-4 bg-cad-primary hover:bg-cad-primaryHover text-white text-sm font-bold rounded transition-colors shadow-lg shadow-blue-500/20"
        >
          <span className="material-symbols-outlined text-[18px]">
            download
          </span>
          <span>Export</span>
        </button>

        <button
          onClick={toggleTheme}
          className="size-8 rounded-full bg-cad-panel border border-cad-border flex items-center justify-center text-xs font-bold text-cad-text cursor-pointer hover:bg-cad-border transition-colors"
          title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          <span className="material-symbols-outlined text-[18px]">
            {isDark ? "light_mode" : "dark_mode"}
          </span>
        </button>
      </div>
    </header>
  );
};

export default Header;
