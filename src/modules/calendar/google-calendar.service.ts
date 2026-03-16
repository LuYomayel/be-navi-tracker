import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import * as crypto from 'crypto';

// googleapis is an optional dependency - Google Calendar features
// will only work when GOOGLE_CLIENT_ID is configured
let google: any;
try {
  google = require('googleapis').google;
} catch {
  // googleapis not installed - Google Calendar features disabled
}

@Injectable()
export class GoogleCalendarService {
  private oauth2Client: any;

  constructor(private prisma: PrismaService) {
    if (
      google &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET
    ) {
      this.oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI,
      );
    }
  }

  private ensureConfigured() {
    if (!this.oauth2Client) {
      throw new NotFoundException(
        'Google Calendar not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.',
      );
    }
  }

  async getAuthUrl(userId: string) {
    this.ensureConfigured();
    const url = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/calendar.events',
      ],
      state: userId,
      prompt: 'consent',
    });
    return { url };
  }

  async handleCallback(userId: string, code: string) {
    this.ensureConfigured();
    const { tokens } = await this.oauth2Client.getToken(code);

    await this.prisma.googleCalendarConnection.upsert({
      where: { userId },
      create: {
        userId,
        accessToken: this.encrypt(tokens.access_token),
        refreshToken: this.encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(tokens.expiry_date),
      },
      update: {
        accessToken: this.encrypt(tokens.access_token),
        ...(tokens.refresh_token
          ? { refreshToken: this.encrypt(tokens.refresh_token) }
          : {}),
        tokenExpiresAt: new Date(tokens.expiry_date),
      },
    });

    await this.sync(userId);
    return { connected: true };
  }

  async sync(userId: string) {
    this.ensureConfigured();
    const connection =
      await this.prisma.googleCalendarConnection.findUnique({
        where: { userId },
      });
    if (!connection)
      throw new NotFoundException('Google Calendar not connected');

    this.oauth2Client.setCredentials({
      access_token: this.decrypt(connection.accessToken),
      refresh_token: this.decrypt(connection.refreshToken),
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });

    const now = new Date();
    const thirtyDaysLater = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    );

    const listParams: any = {
      calendarId: connection.calendarId || 'primary',
      timeMin: now.toISOString(),
      timeMax: thirtyDaysLater.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    };
    if (connection.syncToken) {
      listParams.syncToken = connection.syncToken;
      delete listParams.timeMin;
      delete listParams.timeMax;
    }

    let response;
    try {
      response = await calendar.events.list(listParams);
    } catch (err: any) {
      // If sync token is invalid, do a full sync
      if (err?.code === 410) {
        delete listParams.syncToken;
        listParams.timeMin = now.toISOString();
        listParams.timeMax = thirtyDaysLater.toISOString();
        response = await calendar.events.list(listParams);
      } else {
        throw err;
      }
    }

    const events = response.data.items || [];
    let syncedCount = 0;

    for (const event of events) {
      if (event.status === 'cancelled') {
        await this.prisma.calendarEvent.deleteMany({
          where: { googleEventId: event.id, userId },
        });
        continue;
      }

      const startTime = event.start?.dateTime || event.start?.date;
      const endTime = event.end?.dateTime || event.end?.date;
      const allDay = !event.start?.dateTime;

      await this.prisma.calendarEvent.upsert({
        where: { googleEventId: event.id },
        create: {
          userId,
          googleEventId: event.id,
          title: event.summary || '(Sin titulo)',
          description: event.description,
          location: event.location,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          allDay,
          source: 'google',
          syncedAt: new Date(),
        },
        update: {
          title: event.summary || '(Sin titulo)',
          description: event.description,
          location: event.location,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          allDay,
          syncedAt: new Date(),
        },
      });
      syncedCount++;
    }

    if (response.data.nextSyncToken) {
      await this.prisma.googleCalendarConnection.update({
        where: { userId },
        data: {
          syncToken: response.data.nextSyncToken,
          lastSyncAt: new Date(),
        },
      });
    }

    return { synced: syncedCount };
  }

  async disconnect(userId: string) {
    await this.prisma.calendarEvent.deleteMany({
      where: { userId, source: 'google' },
    });
    await this.prisma.googleCalendarConnection
      .delete({ where: { userId } })
      .catch(() => {
        // Already disconnected
      });
    return { disconnected: true };
  }

  async getStatus(userId: string) {
    const connection =
      await this.prisma.googleCalendarConnection.findUnique({
        where: { userId },
      });
    return {
      connected: !!connection,
      syncEnabled: connection?.syncEnabled ?? false,
      lastSyncAt: connection?.lastSyncAt,
      calendarId: connection?.calendarId,
    };
  }

  // AES-256-GCM encryption
  private getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      // Fallback: use a derived key from JWT_SECRET (not ideal but functional)
      const secret = process.env.JWT_SECRET || 'navitracker-default-key';
      return crypto.scryptSync(secret, 'salt', 32);
    }
    // If key is hex-encoded 32 bytes
    if (key.length === 64) return Buffer.from(key, 'hex');
    // Otherwise derive from it
    return crypto.scryptSync(key, 'salt', 32);
  }

  private encrypt(text: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const key = this.getEncryptionKey();
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
