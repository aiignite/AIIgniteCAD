import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { UnsafeEndpointError, assertSafeLLMEndpoint } from "../src/lib/urlGuard";

const ollama = { provider: "Ollama", requireHttps: false };
const openai = { provider: "OpenAI", requireHttps: false };

describe("assertSafeLLMEndpoint", () => {
  const original = process.env.AI_ALLOWED_ENDPOINTS;
  const originalPrivate = process.env.AI_ALLOW_PRIVATE_ENDPOINTS;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (original === undefined) delete process.env.AI_ALLOWED_ENDPOINTS;
    else process.env.AI_ALLOWED_ENDPOINTS = original;
    if (originalPrivate === undefined) delete process.env.AI_ALLOW_PRIVATE_ENDPOINTS;
    else process.env.AI_ALLOW_PRIVATE_ENDPOINTS = originalPrivate;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("接受公网 https 端点并去掉尾部斜杠", () => {
    expect(assertSafeLLMEndpoint("https://api.openai.com/v1/", openai)).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("允许本地回环，供 Ollama 与本地网关使用", () => {
    expect(assertSafeLLMEndpoint("http://localhost:11434", ollama)).toBe("http://localhost:11434");
    expect(assertSafeLLMEndpoint("http://127.0.0.1:11434", ollama)).toBe("http://127.0.0.1:11434");
  });

  it("拒绝非 http(s) 协议与相对地址", () => {
    expect(() => assertSafeLLMEndpoint("file:///etc/passwd", openai)).toThrow(UnsafeEndpointError);
    expect(() => assertSafeLLMEndpoint("gopher://127.0.0.1:1/", openai)).toThrow(UnsafeEndpointError);
    expect(() => assertSafeLLMEndpoint("localhost:11434", ollama)).toThrow(/只允许 http/);
    expect(() => assertSafeLLMEndpoint("not a url at all", ollama)).toThrow(/绝对 URL/);
    expect(() => assertSafeLLMEndpoint("", openai)).toThrow(/不能为空/);
  });

  it("拒绝 URL 内嵌凭据", () => {
    expect(() => assertSafeLLMEndpoint("https://user:pass@api.openai.com/v1", openai)).toThrow(
      /凭据/,
    );
  });

  it("拒绝云元数据地址", () => {
    expect(() => assertSafeLLMEndpoint("http://169.254.169.254/latest/meta-data", openai)).toThrow(
      /元数据|链路本地/,
    );
    expect(() => assertSafeLLMEndpoint("http://metadata.google.internal/x", openai)).toThrow(
      /元数据/,
    );
  });

  it("非 Ollama provider 访问私网需要白名单", () => {
    expect(() => assertSafeLLMEndpoint("http://10.0.0.5:8080/v1", openai)).toThrow(/内网/);
    expect(() => assertSafeLLMEndpoint("http://192.168.1.10/v1", openai)).toThrow(/内网/);
    expect(() => assertSafeLLMEndpoint("http://172.16.0.9/v1", openai)).toThrow(/内网/);

    process.env.AI_ALLOWED_ENDPOINTS = "internal-llm,http://10.0.0.5:8080";
    expect(assertSafeLLMEndpoint("http://internal-llm:8080/v1", openai)).toBe(
      "http://internal-llm:8080/v1",
    );
    expect(assertSafeLLMEndpoint("http://10.0.0.5:8080/v1", openai)).toBe("http://10.0.0.5:8080/v1");
  });

  it("Ollama 允许私网端点（本地推理集群）", () => {
    expect(assertSafeLLMEndpoint("http://10.0.0.7:11434", ollama)).toBe("http://10.0.0.7:11434");
  });

  it("开启 AI_ALLOW_PRIVATE_ENDPOINTS 后允许 OpenAI 兼容 provider 使用内网 HTTP", () => {
    process.env.AI_ALLOW_PRIVATE_ENDPOINTS = "true";
    process.env.NODE_ENV = "production";

    expect(assertSafeLLMEndpoint("http://192.168.1.20:3000/v1", openai)).toBe(
      "http://192.168.1.20:3000/v1",
    );
    expect(assertSafeLLMEndpoint("http://10.0.0.5:8080/v1", openai)).toBe(
      "http://10.0.0.5:8080/v1",
    );
    expect(assertSafeLLMEndpoint("http://[fd00::10]:8000/v1", openai)).toBe(
      "http://[fd00::10]:8000/v1",
    );
  });

  it("开关关闭或为假值时仍拒绝内网 HTTP", () => {
    process.env.NODE_ENV = "production";
    process.env.AI_ALLOW_PRIVATE_ENDPOINTS = "false";
    expect(() => assertSafeLLMEndpoint("http://192.168.1.20:3000/v1", openai)).toThrow(/内网/);

    delete process.env.AI_ALLOW_PRIVATE_ENDPOINTS;
    expect(() => assertSafeLLMEndpoint("http://192.168.1.20:3000/v1", openai)).toThrow(/内网/);
  });

  it("开关不会放行公网 HTTP、元数据与链路本地地址", () => {
    process.env.AI_ALLOW_PRIVATE_ENDPOINTS = "true";
    process.env.NODE_ENV = "production";

    expect(() => assertSafeLLMEndpoint("http://api.example.com/v1", openai)).toThrow(/https/);
    expect(() => assertSafeLLMEndpoint("http://169.254.169.254/latest/meta-data", openai)).toThrow(
      /链路本地|元数据/,
    );
    expect(() => assertSafeLLMEndpoint("http://[fe80::1]:8080/v1", openai)).toThrow(/链路本地/);
    expect(() => assertSafeLLMEndpoint("http://metadata.google.internal/x", openai)).toThrow(
      /元数据/,
    );
  });

  it("内网域名形式仍需白名单", () => {
    process.env.AI_ALLOW_PRIVATE_ENDPOINTS = "true";
    process.env.NODE_ENV = "production";

    expect(() => assertSafeLLMEndpoint("http://ccswitch.lan:3000/v1", openai)).toThrow(/https/);

    process.env.AI_ALLOWED_ENDPOINTS = "ccswitch.lan";
    expect(assertSafeLLMEndpoint("http://ccswitch.lan:3000/v1", openai)).toBe(
      "http://ccswitch.lan:3000/v1",
    );
  });

  it("生产环境下非本地 http 端点必须升级 https", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertSafeLLMEndpoint("http://api.example.com/v1", openai)).toThrow(/https/);
    expect(assertSafeLLMEndpoint("https://api.example.com/v1", openai)).toBe(
      "https://api.example.com/v1",
    );
    // 回环仍允许 http
    expect(assertSafeLLMEndpoint("http://localhost:11434", ollama)).toBe("http://localhost:11434");
  });

  it("IPv6 唯一本地地址按私网处理", () => {
    expect(() => assertSafeLLMEndpoint("http://[fd00::10]:8000/v1", openai)).toThrow(/内网/);
    expect(assertSafeLLMEndpoint("http://[::1]:11434", ollama)).toBe("http://[::1]:11434");

    // 去掉方括号后仍能识别回环，生产环境允许 http
    process.env.NODE_ENV = "production";
    expect(assertSafeLLMEndpoint("http://[::1]:11434", openai)).toBe("http://[::1]:11434");
  });
});

describe("env defaults", () => {
  beforeEach(() => {
    delete process.env.AI_ALLOWED_ENDPOINTS;
    delete process.env.AI_ALLOW_PRIVATE_ENDPOINTS;
  });

  it("白名单为空时不放行私网", () => {
    expect(() => assertSafeLLMEndpoint("http://10.1.2.3/v1", openai)).toThrow(/内网/);
  });
});
