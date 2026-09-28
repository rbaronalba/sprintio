import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { backgroundBody } from './board.service';

export interface Board {
  id: string;
  title: string;
  ownerId: string;
  workspaceId: string;
  background: string;
  starred: boolean;
  /** When the current user last opened it; null if never. */
  lastViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  /** False when the user only sees it through a board they were invited to directly. */
  isMember: boolean;
  /** Only ever set for the owner. */
  inviteToken: string | null;
}

export interface WorkspaceInvitePreview {
  workspaceId: string;
  name: string;
  isMember: boolean;
}

export interface Member {
  userId: string;
  email: string;
  displayName: string | null;
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
  background: string;
  starred: boolean;
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

  /** Without a workspace the API files the board in the user's first one. */
  create(title: string, workspaceId?: string): Observable<Board> {
    return this.http.post<Board>('/boards', { title, workspaceId });
  }

  listWorkspaces(): Observable<Workspace[]> {
    return this.http.get<Workspace[]>('/workspaces');
  }

  createWorkspace(name: string): Observable<Workspace> {
    return this.http.post<Workspace>('/workspaces', { name });
  }

  renameWorkspace(id: string, name: string): Observable<Workspace> {
    return this.http.patch<Workspace>(`/workspaces/${id}`, { name });
  }

  createWorkspaceInvite(id: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`/workspaces/${id}/invite`, {});
  }

  revokeWorkspaceInvite(id: string): Observable<unknown> {
    return this.http.delete(`/workspaces/${id}/invite`);
  }

  previewWorkspaceInvite(token: string): Observable<WorkspaceInvitePreview> {
    return this.http.get<WorkspaceInvitePreview>(`/workspaces/join/${encodeURIComponent(token)}`);
  }

  joinWorkspace(token: string): Observable<{ workspaceId: string }> {
    return this.http.post<{ workspaceId: string }>(`/workspaces/join/${encodeURIComponent(token)}`, {});
  }

  workspaceMembers(id: string): Observable<Member[]> {
    return this.http.get<Member[]>(`/workspaces/${id}/members`);
  }

  /** Owner removing someone, or anyone passing their own id to leave. */
  removeWorkspaceMember(id: string, userId: string): Observable<unknown> {
    return this.http.delete(`/workspaces/${id}/members/${userId}`);
  }

  /** Deletes every board in it too. */
  removeWorkspace(id: string): Observable<unknown> {
    return this.http.delete(`/workspaces/${id}`);
  }

  /** Owner only. */
  rename(id: string, title: string): Observable<Board> {
    return this.http.patch<Board>(`/boards/${id}`, { title });
  }

  remove(id: string): Observable<unknown> {
    return this.http.delete(`/boards/${id}`);
  }

  get(id: string): Observable<BoardDetail> {
    return this.http.get<BoardDetail>(`/boards/${id}`);
  }

  setStarred(id: string, starred: boolean): Observable<{ starred: boolean }> {
    return this.http.put<{ starred: boolean }>(`/boards/${id}/star`, { starred });
  }

  /** A File uploads an image; a string sets a palette color, or '' clears it. */
  setBackground(id: string, value: string | File): Observable<{ background: string }> {
    return this.http.post<{ background: string }>(`/boards/${id}/background`, backgroundBody(value));
  }

  createInvite(id: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`/boards/${id}/invite`, {});
  }

  revokeInvite(id: string): Observable<unknown> {
    return this.http.delete(`/boards/${id}/invite`);
  }

  previewInvite(token: string): Observable<InvitePreview> {
    return this.http.get<InvitePreview>(`/boards/join/${encodeURIComponent(token)}`);
  }

  join(token: string): Observable<{ boardId: string }> {
    return this.http.post<{ boardId: string }>(`/boards/join/${encodeURIComponent(token)}`, {});
  }

  /** Owner removing someone, or anyone passing their own id to leave. */
  removeMember(boardId: string, userId: string): Observable<unknown> {
    return this.http.delete(`/boards/${boardId}/members/${userId}`);
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
