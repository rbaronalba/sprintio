import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';

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

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface BoardDetail {
  id: string;
  title: string;
  ownerId: string;
  inviteToken: string | null;
  members: Member[];
  labels: Label[];
}

export interface InvitePreview {
  boardId: string;
  title: string;
  isMember: boolean;
}

export interface SearchHit {
  cardId: string;
  title: string;
  listTitle: string;
  boardId: string;
  boardTitle: string;
}

export interface ActivityEntry {
  id: string;
  type: string;
  cardId: string | null;
  actor: { email: string; displayName: string | null };
  data: Record<string, unknown>;
  createdAt: string;
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

  search(term: string): Observable<SearchHit[]> {
    // The API needs two characters to match; skip the round trip below that.
    if (term.trim().length < 2) return of([]);
    return this.http.get<SearchHit[]>('/search', { params: { q: term.trim() } });
  }

  listActivity(boardId: string): Observable<ActivityEntry[]> {
    return this.http.get<ActivityEntry[]>(`/boards/${boardId}/activity`);
  }

  createLabel(boardId: string, name: string, color: string): Observable<Label> {
    return this.http.post<Label>(`/boards/${boardId}/labels`, { name, color });
  }

  removeLabel(boardId: string, labelId: string): Observable<unknown> {
    return this.http.delete(`/boards/${boardId}/labels/${labelId}`);
  }
}
