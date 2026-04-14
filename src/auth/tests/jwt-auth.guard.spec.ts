import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import jest from 'jest-mock';

// ── Helpers ───────────────────────────────────────────────────────────────────
const createMockContext = (isPublic = false): ExecutionContext =>
  ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({
        headers: { authorization: 'Bearer mock-token' },
      }),
    }),
  } as unknown as ExecutionContext);

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access to @Public() routes without a token', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true); // isPublic = true
    const ctx = createMockContext();
    const result = guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should throw UnauthorizedException when no user is returned', () => {
    expect(() => guard.handleRequest(null, null)).toThrow(UnauthorizedException);
  });

  it('should return user when valid', () => {
    const mockUser = { id: 'uuid', email: 'test@test.com' };
    const result = guard.handleRequest(null, mockUser);
    expect(result).toBe(mockUser);
  });

  it('should rethrow the original error if provided', () => {
    const originalError = new UnauthorizedException('Token expired');
    expect(() => guard.handleRequest(originalError, null)).toThrow(originalError);
  });
});
