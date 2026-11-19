import { HttpTestingController } from '@angular/common/http/testing';

/**
 * Logging in opens the live stream and loads the bell. Specs that are about something
 * else answer both here so `httpMock.verify()` has nothing left over.
 */
export function flushSessionRequests(httpMock: HttpTestingController): void {
  httpMock
    .match('/events/ticket')
    .forEach((req) => req.flush({ ticket: 'stream-ticket' }));
  httpMock
    .match('/notifications')
    .forEach((req) => req.flush({ unread: 0, items: [] }));
}
