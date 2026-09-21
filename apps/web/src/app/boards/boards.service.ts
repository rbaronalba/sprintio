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
}
