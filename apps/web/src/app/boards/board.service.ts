import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Card {
  id: string;
  title: string;
  description: string | null;
  assignees: { userId: string }[];
  position: number;
  listId: string;
}

export interface List {
  id: string;
  title: string;
  position: number;
  boardId: string;
  cards: Card[];
}

@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly http = inject(HttpClient);

  listLists(boardId: string): Observable<List[]> {
    return this.http.get<List[]>(`/boards/${boardId}/lists`);
  }

  createList(boardId: string, title: string): Observable<List> {
    return this.http.post<List>(`/boards/${boardId}/lists`, { title });
  }

  renameList(id: string, title: string): Observable<List> {
    return this.http.patch<List>(`/lists/${id}`, { title });
  }

  moveList(id: string, position: number): Observable<List> {
    return this.http.patch<List>(`/lists/${id}`, { position });
  }

  removeList(id: string): Observable<unknown> {
    return this.http.delete(`/lists/${id}`);
  }

  createCard(listId: string, title: string): Observable<Card> {
    return this.http.post<Card>(`/lists/${listId}/cards`, { title });
  }

  updateCard(id: string, patch: { title?: string; description?: string | null }): Observable<Card> {
    return this.http.patch<Card>(`/cards/${id}`, patch);
  }

  moveCard(id: string, listId: string, position: number): Observable<Card> {
    return this.http.patch<Card>(`/cards/${id}`, { listId, position });
  }

  removeCard(id: string): Observable<unknown> {
    return this.http.delete(`/cards/${id}`);
  }

  assign(cardId: string, userId: string): Observable<unknown> {
    return this.http.put(`/cards/${cardId}/members/${userId}`, {});
  }

  unassign(cardId: string, userId: string): Observable<unknown> {
    return this.http.delete(`/cards/${cardId}/members/${userId}`);
  }
}
