import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Board {
  id: string;
  title: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  userId: string;
  email: string;
}

export interface BoardDetail {
  id: string;
  title: string;
  ownerId: string;
  inviteToken: string | null;
  members: Member[];
}

export interface InvitePreview {
  boardId: string;
  title: string;
  isMember: boolean;
}

@Injectable({ providedIn: 'root' })
export class BoardsService {
  private readonly http = inject(HttpClient);

  list(): Observable<Board[]> {
    return this.http.get<Board[]>('/boards');
  }

  create(title: string): Observable<Board> {
    return this.http.post<Board>('/boards', { title });
  }

  remove(id: string): Observable<unknown> {
    return this.http.delete(`/boards/${id}`);
  }

  get(id: string): Observable<BoardDetail> {
    return this.http.get<BoardDetail>(`/boards/${id}`);
  }

  createInvite(id: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`/boards/${id}/invite`, {});
  }

  revokeInvite(id: string): Observable<unknown> {
    return this.http.delete(`/boards/${id}/invite`);
  }

  previewInvite(token: string): Observable<InvitePreview> {
    return this.http.get<InvitePreview>(`/boards/join/${token}`);
  }

  join(token: string): Observable<{ boardId: string }> {
    return this.http.post<{ boardId: string }>(`/boards/join/${token}`, {});
  }
}
