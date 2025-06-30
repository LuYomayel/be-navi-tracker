import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ApiErrorResponse {
  success: false;
  data: null;
  message: string;
  errors?: any;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let apiResponse: ApiErrorResponse = {
      success: false,
      data: null,
      message: 'Internal server error',
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (exception instanceof BadRequestException) {
        // class-validator errors
        const validationErrors =
          (exceptionResponse as any)?.message || exceptionResponse;
        apiResponse = {
          success: false,
          data: null,
          message: 'Validation failed',
          errors: validationErrors,
        };
      } else {
        const message =
          (exceptionResponse as any)?.message || exception.message || null;
        apiResponse = {
          success: false,
          data: null,
          message: message || 'Request error',
        };
      }
    }

    // log error for debugging
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('❌ HttpExceptionFilter:', exception);
    }

    response.status(status).json(apiResponse);
  }
}
