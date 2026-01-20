import React, { useState } from "react";

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
  loading?: boolean;
  onRegisterClick?: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLogin,
  loading,
  onRegisterClick,
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await onLogin(email, password);
    } catch (err) {
      console.error("Login failed:", err);
    }
  };

  return (
    <div className="flex min-h-screen w-screen bg-white dark:bg-[#0d1116] font-display">
      {/* Left Side - Brand / Visuals */}
      <div className="hidden lg:flex w-1/2 bg-[#050505] relative flex-col justify-end p-16 overflow-hidden">
        {/* Abstract Background Elements */}
        <div className="absolute inset-0 z-0 opacity-20">
          <div className="absolute top-0 left-0 w-full h-full bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
          <div className="absolute bottom-0 left-0 right-0 h-2/3 bg-gradient-to-t from-[#137fec]/10 to-transparent"></div>
        </div>

        {/* Glowing Orb Effect */}
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-[#137fec] rounded-full filter blur-[120px] opacity-20 animate-pulse"></div>

        <div className="relative z-10 mb-8">
          {/* Logo */}
          <div className="flex items-center gap-4 mb-6">
            <div className="size-16 shrink-0">
              <svg
                viewBox="0 0 200 200"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full drop-shadow-[0_0_15px_rgba(19,127,236,0.5)]"
              >
                <defs>
                  <linearGradient
                    id="login-bg-gradient"
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
                    id="login-halo-gradient"
                    cx="100"
                    cy="110"
                    r="60"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="20%" stopColor="white" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                  </radialGradient>

                  <mask id="login-fire-mask">
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
                  fill="url(#login-bg-gradient)"
                />

                <path
                  d="M100 148 C 65 148, 55 115, 80 85 C 95 65, 125 55, 105 25 C 135 55, 150 95, 130 125 C 120 142, 115 148, 100 148Z"
                  fill="url(#login-halo-gradient)"
                />

                <path
                  d="M100 142 C 78 142, 70 115, 88 92 C 98 80, 115 65, 105 40 C 128 65, 138 100, 122 128 C 115 140, 110 142, 100 142Z"
                  fill="white"
                  mask="url(#login-fire-mask)"
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
            <h1 className="text-4xl font-bold text-white tracking-tight">
              AI Ignite CAD
            </h1>
          </div>

          <div className="space-y-4 max-w-lg">
            <p className="text-2xl font-medium text-white leading-tight">
              Engineering limits broken.
            </p>
            <p className="text-xl font-bold text-[#137fec] bg-clip-text text-transparent bg-gradient-to-r from-[#137fec] to-white">
              The Future of Intelligent Design.
            </p>
          </div>

          <div className="mt-12 flex gap-2">
            <div className="w-12 h-1.5 bg-[#137fec] rounded-full"></div>
            <div className="w-3 h-1.5 bg-gray-700 rounded-full"></div>
            <div className="w-3 h-1.5 bg-gray-700 rounded-full"></div>
          </div>
        </div>

        <div className="relative z-10 text-xs text-gray-500 font-mono">
          V5.2.0 IGNITE BUILD
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white dark:bg-[#0d1116] text-[#24292f] dark:text-[#e6edf3]">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Please enter your credentials to access your engineering
              workspaces.
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-semibold">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="engineer@firm.com"
                  className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] focus:border-[#137fec] focus:ring-1 focus:ring-[#137fec] outline-none transition-all placeholder-gray-400"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-semibold">
                    Password
                  </label>
                  <a
                    href="#"
                    className="text-xs font-semibold text-[#3b82f6] hover:text-[#2563eb]"
                  >
                    Forgot password?
                  </a>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="••••••••"
                    className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] focus:border-[#137fec] focus:ring-1 focus:ring-[#137fec] outline-none transition-all placeholder-gray-400"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showPassword ? "visibility_off" : "visibility"}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-[#137fec] to-[#0b63c1] hover:from-[#0b63c1] hover:to-[#094a8f] text-white font-bold rounded-lg shadow-lg shadow-blue-500/20 transform transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="material-symbols-outlined animate-spin text-[20px]">
                  progress_activity
                </span>
              ) : (
                <>
                  <span>Sign In</span>
                  <span className="material-symbols-outlined text-[20px]">
                    arrow_forward
                  </span>
                </>
              )}
            </button>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}
          </form>

          <div className="text-center text-sm">
            <span className="text-gray-500">Don't have an account yet?</span>{" "}
            <button
              onClick={onRegisterClick}
              className="font-bold text-[#3b82f6] hover:underline"
            >
              Create Account
            </button>
          </div>

          <div className="flex justify-between items-center text-[10px] text-gray-400 uppercase tracking-wider pt-8">
            <span>v5.2.0 Ignite Build</span>
            <div className="space-x-4">
              <a href="#" className="hover:text-gray-600">
                Security
              </a>
              <a href="#" className="hover:text-gray-600">
                Docs
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
