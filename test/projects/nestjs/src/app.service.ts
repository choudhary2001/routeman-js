import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly startedAt = new Date();

  getHealth() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      startedAt: this.startedAt.toISOString(),
    };
  }
}
