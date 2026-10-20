import { Controller, Get } from '@nestjs/common';

export interface HealthCheckResponse {
  status: 'ok';
  timestamp: string;
  uptime: number;
}

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthCheckResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    };
  }
}
