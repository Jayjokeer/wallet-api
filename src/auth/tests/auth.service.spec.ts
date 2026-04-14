import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from '../auth.service';
import { UsersService } from '../../users/users.service';
import { WalletService } from '../../wallet/wallet.service';
import { UserRole } from '../../users/entities/user.entity';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  password: 'hashed_password',
  role: UserRole.USER,
  createdAt: new Date(),
};

const mockUsersService = {
  existsByEmail: jest.fn(),
  create: jest.fn(),
  findByEmailWithPassword: jest.fn(),
  findById: jest.fn(),
};

const mockWalletService = {
  createWallet: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string) => {
    const config: Record<string, string> = {
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      JWT_REFRESH_EXPIRES_IN: '7d',
    };
    return config[key] ?? null;
  }),
};

// ── Tests ────────────────────────────────────────────────────────────────────
describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: WalletService, useValue: mockWalletService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  // ── Registration ──────────────────────────────────────────────────────────
  describe('register', () => {
    it('should register a new user and return tokens', async () => {
      mockUsersService.existsByEmail.mockResolvedValue(false);
      mockUsersService.create.mockResolvedValue(mockUser);
      mockWalletService.createWallet.mockResolvedValue({});

      const result = await authService.register({
        email: 'test@example.com',
        password: 'StrongPass123!',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(mockUsersService.create).toHaveBeenCalledTimes(1);
      expect(mockWalletService.createWallet).toHaveBeenCalledWith(mockUser.id);
    });

    it('should throw ConflictException if email is already registered', async () => {
      mockUsersService.existsByEmail.mockResolvedValue(true);

      await expect(
        authService.register({ email: 'taken@example.com', password: 'pass' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should NEVER allow role to be set by client (always USER)', async () => {
      mockUsersService.existsByEmail.mockResolvedValue(false);
      mockUsersService.create.mockResolvedValue(mockUser);
      mockWalletService.createWallet.mockResolvedValue({});

      await authService.register({
        email: 'test@example.com',
        password: 'StrongPass123!',
      });

      const createCall = mockUsersService.create.mock.calls[0][0];
      expect(createCall.role).toBe(UserRole.USER);
    });
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      const hash = await argon2.hash('correct-password');
      mockUsersService.findByEmailWithPassword.mockResolvedValue({
        ...mockUser,
        password: hash,
      });

      const result = await authService.login({
        email: 'test@example.com',
        password: 'correct-password',
      });

      expect(result.accessToken).toBeDefined();
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const hash = await argon2.hash('correct-password');
      mockUsersService.findByEmailWithPassword.mockResolvedValue({
        ...mockUser,
        password: hash,
      });

      await expect(
        authService.login({ email: 'test@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for non-existent email', async () => {
      mockUsersService.findByEmailWithPassword.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'nobody@example.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should NOT leak whether email exists in error message', async () => {
      mockUsersService.findByEmailWithPassword.mockResolvedValue(null);

      try {
        await authService.login({ email: 'nobody@example.com', password: 'pass' });
      } catch (err) {
        expect(err.message).toBe('Invalid email or password');
        expect(err.message).not.toContain('email');
        expect(err.message).not.toContain('not found');
      }
    });
  });
});
