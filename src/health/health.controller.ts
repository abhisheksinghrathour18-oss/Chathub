import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

export interface HealthCheckResponse {
  status: 'ok';
  timestamp: string;
  uptime: number;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Check API and service health status',
    description:
      'Returns the current server status, uptime in seconds, and server timestamp.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy and accepting connections.',
    schema: {
      example: {
        status: 'ok',
        timestamp: '2026-10-20T14:50:00.000Z',
        uptime: 124,
      },
    },
  })
  check(): HealthCheckResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    };
  }
}
