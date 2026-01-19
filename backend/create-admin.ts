import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createAdminUser() {
  try {
    // 检查用户是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { email: 'admin@example.com' }
    });

    if (existingUser) {
      console.log('用户 admin@example.com 已存在');
      return;
    }

    // 加密密码
    const passwordHash = await bcrypt.hash('admin123', 10);

    // 创建用户
    const user = await prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@example.com',
        passwordHash: passwordHash,
      },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
      },
    });

    console.log('✅ 管理员用户创建成功:');
    console.log('用户名:', user.username);
    console.log('邮箱:', user.email);
    console.log('密码: admin123');
    console.log('用户ID:', user.id);
  } catch (error) {
    console.error('❌ 创建用户失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdminUser();
