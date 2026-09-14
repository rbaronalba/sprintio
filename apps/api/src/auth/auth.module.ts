import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  // Without this the app would boot and hand out tokens nobody can trust.
  throw new Error('JWT_SECRET is not set');
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: jwtSecret,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PrismaService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
