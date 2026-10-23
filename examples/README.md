# 示例

| 文件 | 用途 |
| --- | --- |
| [sample.dxf](sample.dxf) | 可直接导入的最小 DXF（直线、矩形、圆、圆弧、文字） |
| [gear.dxf](gear.dxf) | 20 齿齿轮轮廓、中心孔与 4 个减重孔 |
| [spring.dxf](spring.dxf) | 12 圈压缩弹簧的二维投影 |
| [floor-plan.dxf](floor-plan.dxf) | 两室户型：墙体、门窗、家具与房间标注 |
| [ai-prompts.md](ai-prompts.md) | AI 自然语言指令与对应工具调用示例 |

齿轮、弹簧与建筑平面同时内置在欢迎页的「示例图纸」中，无需手动导入。修改生成脚本后可重新产出：

```bash
node scripts/generate-examples.mjs
```

## 导入 DXF

1. 启动应用并登录。
2. 在欢迎面板点击 **Import DXF**，或在顶部栏使用 **Import**。
3. 选择 `examples/sample.dxf`，图元会出现在画布中。
4. 点击 **Export** 可再次导出，验证往返兼容性。

## 从示例中学习

- 观察 `sample.dxf` 的组码结构，扩展导入 / 导出时以 `services/dxfService.ts` 为准。
- 使用 AI 提示词示例时，可先在右侧面板选择已配置的模型，再用自然语言描述需求。
