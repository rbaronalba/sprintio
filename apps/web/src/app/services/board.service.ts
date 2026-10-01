import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ActivityEntry } from './boards.service';

export interface Comment {
  id: string;
  body: string;
  authorId: string;
  author: { email: string; displayName: string | null };
  /** Images posted with this comment. */
  attachments: { id: string; path: string; originalName: string }[];
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  date: string;
  hours: number;
  note: string | null;
  userId: string;
  user: { email: string; displayName: string | null };
}

export interface Attachment {
  id: string;
  path: string;
  originalName: string;
  size: number;
  uploaderId: string;
  uploader: { email: string };
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface Card {
  id: string;
  title: string;
  /** Only on a single-card fetch (GET /cards/:id): the board payload leaves it out to stay light. */
  description?: string | null;
  dueDate: string | null;
  dueDone: boolean;
  archived: boolean;
  assignees: { userId: string }[];
  labels: { labelId: string }[];
  hoursTotal: number;
  checklistDone: number;
  _count: { comments: number; attachments: number; checklist: number };
  position: number;
  listId: string;
}

/** Matches the API's page size: a full page means there may be more. */
export const COMMENT_PAGE = 50;

/** A move's answer: where it landed, and whether the gaps ran out and every sibling was renumbered. */
export interface Moved {
  position: number;
  renumbered: boolean;
}

export interface List {
  id: string;
  title: string;
  position: number;
  /** '' (none), a palette color, or an /uploads/ image URL. */
  background: string;
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

  /** Lands the list right after `afterId` (null = first); the server picks the position. */
  moveList(id: string, afterId: string | null): Observable<Moved> {
    return this.http.patch<Moved>(`/lists/${id}`, { afterId });
  }

  /** A File uploads an image; a string sets a palette color, or '' clears it. */
  setListBackground(id: string, value: string | File): Observable<{ background: string }> {
    return this.http.post<{ background: string }>(`/lists/${id}/background`, backgroundBody(value));
  }

  removeList(id: string): Observable<unknown> {
    return this.http.delete(`/lists/${id}`);
  }

  createCard(listId: string, title: string): Observable<Card> {
    return this.http.post<Card>(`/lists/${listId}/cards`, { title });
  }

  updateCard(
    id: string,
    patch: {
      title?: string;
      description?: string | null;
      dueDate?: string | null;
      dueDone?: boolean;
      archived?: boolean;
    },
  ): Observable<Card> {
    return this.http.patch<Card>(`/cards/${id}`, patch);
  }

  listActivity(cardId: string): Observable<ActivityEntry[]> {
    return this.http.get<ActivityEntry[]>(`/cards/${cardId}/activity`);
  }

  /** Lands the card right after `afterId` (null = top) in `listId`; the server picks the position. */
  moveCard(id: string, listId: string, afterId: string | null): Observable<Moved> {
    return this.http.patch<Moved>(`/cards/${id}`, { listId, afterId });
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

  addLabel(cardId: string, labelId: string): Observable<unknown> {
    return this.http.put(`/cards/${cardId}/labels/${labelId}`, {});
  }

  removeLabel(cardId: string, labelId: string): Observable<unknown> {
    return this.http.delete(`/cards/${cardId}/labels/${labelId}`);
  }

  /** Oldest-first page of up to COMMENT_PAGE; `before` asks for the page older than that comment. */
  listComments(cardId: string, before?: string): Observable<Comment[]> {
    return this.http.get<Comment[]>(`/cards/${cardId}/comments`, { params: before ? { before } : {} });
  }

  /** With a file the comment is posted as multipart, the image attached to it. */
  addComment(cardId: string, body: string, file?: File | null): Observable<Comment> {
    if (!file) return this.http.post<Comment>(`/cards/${cardId}/comments`, { body });
    const form = new FormData();
    form.append('body', body);
    form.append('file', file);
    return this.http.post<Comment>(`/cards/${cardId}/comments`, form);
  }

  removeComment(cardId: string, commentId: string): Observable<unknown> {
    return this.http.delete(`/cards/${cardId}/comments/${commentId}`);
  }

  getCard(id: string): Observable<Card> {
    return this.http.get<Card>(`/cards/${id}`);
  }

  listTimeEntries(cardId: string): Observable<TimeEntry[]> {
    return this.http.get<TimeEntry[]>(`/cards/${cardId}/time`);
  }

  addTimeEntry(cardId: string, date: string, hours: number, note?: string, userId?: string): Observable<TimeEntry> {
    return this.http.post<TimeEntry>(`/cards/${cardId}/time`, { date, hours, note, userId });
  }

  updateTimeEntry(cardId: string, entryId: string, hours: number, note: string | null): Observable<TimeEntry> {
    return this.http.patch<TimeEntry>(`/cards/${cardId}/time/${entryId}`, { hours, note });
  }

  removeTimeEntry(cardId: string, entryId: string): Observable<unknown> {
    return this.http.delete(`/cards/${cardId}/time/${entryId}`);
  }

  listAttachments(cardId: string): Observable<Attachment[]> {
    return this.http.get<Attachment[]>(`/cards/${cardId}/attachments`);
  }

  removeAttachment(cardId: string, attachmentId: string): Observable<unknown> {
    return this.http.delete(`/cards/${cardId}/attachments/${attachmentId}`);
  }

  listChecklist(cardId: string): Observable<ChecklistItem[]> {
    return this.http.get<ChecklistItem[]>(`/cards/${cardId}/checklist`);
  }

  addChecklistItem(cardId: string, text: string): Observable<ChecklistItem> {
    return this.http.post<ChecklistItem>(`/cards/${cardId}/checklist`, { text });
  }

  updateChecklistItem(cardId: string, itemId: string, patch: { text?: string; done?: boolean }): Observable<unknown> {
    return this.http.patch(`/cards/${cardId}/checklist/${itemId}`, patch);
  }

  removeChecklistItem(cardId: string, itemId: string): Observable<unknown> {
    return this.http.delete(`/cards/${cardId}/checklist/${itemId}`);
  }
}

export function backgroundBody(value: string | File): FormData | { background: string } {
  if (typeof value === 'string') return { background: value };
  const form = new FormData();
  form.append('file', value);
  return form;
}
