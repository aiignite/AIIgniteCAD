/**
 * 曲线生成测试套件
 * 用于验证各种曲线生成算法的正确性
 */

import {
  generateSineWave,
  generateCosineWave,
  generateSpiral,
  generateLogarithmicSpiral,
  generateQuadraticBezier,
  generateCubicBezier,
  generateArc,
  validateCurve,
  createCurveElement
} from '../services/curveGenerationService';
import { Point, CADElement } from '../types';

/**
 * 测试用例集合
 */
export const curveTests = {
  /**
   * 测试1: 基础正弦波
   * 预期: 标准左右对称的正弦波，从中心开始上升
   */
  testBasicSineWave: (): CADElement => {
    const points = generateSineWave({
      startX: 50,
      endX: 750,
      centerY: 300,
      amplitude: 100,
      wavelength: 400,
      pointCount: 60
    });

    const validation = validateCurve(points);
    console.log('✓ Basic Sine Wave:', validation.valid ? 'PASS' : 'FAIL', validation.issues);

    return createCurveElement(points, 'test-sine-1', 'TEST', '#0000FF');
  },

  /**
   * 测试2: 多波正弦波
   * 预期: 显示2-3个完整波形
   */
  testMultiWaveSine: (): CADElement => {
    const points = generateSineWave({
      startX: 50,
      endX: 750,
      centerY: 300,
      amplitude: 80,
      wavelength: 250, // 更短的波长 = 更多波形
      pointCount: 80
    });

    const validation = validateCurve(points);
    console.log('✓ Multi-Wave Sine:', validation.valid ? 'PASS' : 'FAIL', validation.issues);

    return createCurveElement(points, 'test-sine-multi', 'TEST', '#FF0000');
  },

  /**
   * 测试3: 余弦波（π/2相位偏移的正弦波）
   * 预期: 从峰值开始向下
   */
  testCosineWave: (): CADElement => {
    const points = generateCosineWave({
      startX: 50,
      endX: 750,
      centerY: 300,
      amplitude: 100,
      wavelength: 400,
      pointCount: 60,
      phaseShift: 0 // 标准余弦
    });

    const validation = validateCurve(points);
    console.log('✓ Cosine Wave:', validation.valid ? 'PASS' : 'FAIL', validation.issues);

    return createCurveElement(points, 'test-cosine', 'TEST', '#00FF00');
  },

  /**
   * 测试4: 阿基米德螺旋
   * 预期: 逐渐展开的螺旋
   */
  testArchimedeanSpiral: (): CADElement => {
    const points = generateSpiral({
      centerX: 400,
      centerY: 300,
      startRadius: 20,
      endRadius: 200,
      turns: 3, // 3圈
      pointCount: 100
    });

    const validation = validateCurve(points);
    console.log('✓ Archimedean Spiral:', validation.valid ? 'PASS' : 'FAIL', validation.issues);

    return createCurveElement(points, 'test-spiral', 'TEST', '#FFA500');
  },

  /**
   * 测试5: 对数螺旋
   * 预期: 自然增长的螺旋
   */
  testLogarithmicSpiral: (): CADElement => {
    const points = generateLogarithmicSpiral(
      400, // centerX
      300, // centerY
      10, // a (初始半径)
      0.2, // b (增长系数)
      4 * Math.PI, // 2圈
      100 // pointCount
    );

    const validation = validateCurve(points);
    console.log('✓ Logarithmic Spiral:', validation.valid ? 'PASS' : 'FAIL', validation.issues);

    return createCurveElement(points, 'test-log-spiral', 'TEST', '#9400D3');
  },

  /**
   * 测试6: 二次贝塞尔曲线
   * 预期: 光滑的抛物线形曲线
   */
  testQuadraticBezier: (): CADElement => {
    const p0: Point = { x: 100, y: 300 };
    const p1: Point = { x: 400, y: 100 }; // 控制点
    const p2: Point = { x: 700, y: 300 };

    const points = generateQuadraticBezier(p0, p1, p2, 50);

    const validation = validateCurve(points);
    console.log('✓ Quadratic Bezier:', validation.valid ? 'PASS' : 'FAIL', validation.issues);

    return createCurveElement(points, 'test-bezier-quad', 'TEST', '#00FFFF');
  },

  /**
   * 测试7: 三次贝塞尔曲线
   * 预期: 更复杂的光滑曲线
   */
  testCubicBezier: (): CADElement => {
    const p0: Point = { x: 100, y: 350 };
    const p1: Point = { x: 200, y: 100 }; // 控制点1
    const p2: Point = { x: 600, y: 100 }; // 控制点2
    const p3: Point = { x: 700, y: 350 };

    const points = generateCubicBezier(p0, p1, p2, p3, 60);

    const validation = validateCurve(points);
    console.log('✓ Cubic Bezier:', validation.valid ? 'PASS' : 'FAIL', validation.issues);

    return createCurveElement(points, 'test-bezier-cubic', 'TEST', '#FFD700');
  },

  /**
   * 测试8: 圆弧
   * 预期: 完整的圆或部分圆弧
   */
  testArc: (): CADElement => {
    const points = generateArc(
      400, // centerX
      300, // centerY
      100, // radius
      0, // startAngle (度数)
      360, // endAngle (完整圆)
      100 // pointCount
    );

    const validation = validateCurve(points);
    console.log('✓ Arc:', validation.valid ? 'PASS' : 'FAIL', validation.issues);

    return createCurveElement(points, 'test-arc', 'TEST', '#00AA00');
  },

  /**
   * 数据验证测试
   * 测试validateCurve函数的各种场景
   */
  testValidationCases: (): void => {
    console.log('\n=== Validation Tests ===');

    // 场景1: 有效的曲线
    const validCurve: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 5 }
    ];
    console.log('Valid curve:', validateCurve(validCurve));

    // 场景2: 点数过少
    const tooFewPoints: Point[] = [{ x: 0, y: 0 }];
    console.log('Too few points:', validateCurve(tooFewPoints));

    // 场景3: 竖直线（X不变）
    const verticalLine: Point[] = [
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 20 }
    ];
    console.log('Vertical line:', validateCurve(verticalLine));

    // 场景4: 包含NaN
    const withNaN: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: NaN },
      { x: 20, y: 20 }
    ];
    console.log('Contains NaN:', validateCurve(withNaN));

    // 场景5: X不单调
    const nonMonotonicX: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 20 } // X递减
    ];
    console.log('Non-monotonic X:', validateCurve(nonMonotonicX));
  },

  /**
   * 对比测试: AI数据 vs 生成数据
   */
  testComparisonAIvsCorrected: (): void => {
    console.log('\n=== AI Data vs Corrected Data ===');

    // AI原始数据（问题数据）
    const aiData: Point[] = [
      { x: 50, y: 300 },
      { x: 70, y: 270.9 },
      { x: 90, y: 245.4 },
      { x: 110, y: 225 },
      { x: 130, y: 210.9 },
      { x: 150, y: 204.5 },
      // ... 省略中间数据
      { x: 750, y: 370.1 }
    ];

    // 生成修正后的数据
    const correctedData = generateSineWave({
      startX: 50,
      endX: 750,
      centerY: 296.2, // (204.5 + 387.9) / 2
      amplitude: 91.7, // (387.9 - 204.5) / 2
      wavelength: 400,
      pointCount: 35 // 接近原始36个点
    });

    // 对比分析
    const aiValidation = validateCurve(aiData);
    const correctedValidation = validateCurve(correctedData);

    console.log('AI Data Issues:', aiValidation.issues);
    console.log('Corrected Data Issues:', correctedValidation.issues);

    // 数学验证
    console.log('\nFirst 5 points comparison:');
    for (let i = 0; i < Math.min(5, correctedData.length); i++) {
      console.log(`Point ${i}:`);
      console.log(`  AI:        (${aiData[i]?.x}, ${aiData[i]?.y})`);
      console.log(`  Corrected: (${correctedData[i].x}, ${correctedData[i].y})`);
    }
  }
};

/**
 * 运行所有测试
 */
export const runAllTests = (): CADElement[] => {
  console.log('=== Running Curve Generation Tests ===\n');

  const results: CADElement[] = [];

  try {
    results.push(curveTests.testBasicSineWave());
    results.push(curveTests.testMultiWaveSine());
    results.push(curveTests.testCosineWave());
    results.push(curveTests.testArchimedeanSpiral());
    results.push(curveTests.testLogarithmicSpiral());
    results.push(curveTests.testQuadraticBezier());
    results.push(curveTests.testCubicBezier());
    results.push(curveTests.testArc());
  } catch (error) {
    console.error('Test execution error:', error);
  }

  curveTests.testValidationCases();
  curveTests.testComparisonAIvsCorrected();

  console.log('\n=== Tests Complete ===');
  return results;
};

/**
 * 快速测试：仅测试正弦波
 */
export const quickSineWaveTest = (): CADElement => {
  const points = generateSineWave({
    startX: 50,
    endX: 750,
    centerY: 300,
    amplitude: 100,
    wavelength: 400,
    pointCount: 60
  });

  console.log('Quick Sine Wave Test:');
  console.log(`Generated ${points.length} points`);
  console.log(`First point: (${points[0].x}, ${points[0].y})`);
  console.log(`Last point: (${points[points.length - 1].x}, ${points[points.length - 1].y})`);

  const validation = validateCurve(points);
  console.log('Validation:', validation.valid ? 'PASS ✓' : 'FAIL ✗', validation.issues);

  return createCurveElement(points, 'quick-test-sine', 'TEST', '#0000FF');
};

export default {
  curveTests,
  runAllTests,
  quickSineWaveTest
};
