import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { UsersRepository } from './users.repository';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository.findByEmailWithPassword(email);
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async existsByEmail(email: string): Promise<boolean> {
    return this.usersRepository.existsByEmail(email);
  }

  async create(data: Partial<User>): Promise<User> {
    const exists = await this.usersRepository.existsByEmail(data.email);
    if (exists) throw new ConflictException('Email already registered');
    return this.usersRepository.create(data);
  }
}
