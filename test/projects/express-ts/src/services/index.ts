import { db } from './db.js';
import { AuthService } from './auth.service.js';
import { ProjectService } from './project.service.js';
import { TaskService } from './task.service.js';

// Poor man's DI container
export const authService = new AuthService(db);
export const projectService = new ProjectService(db);
export const taskService = new TaskService(db, projectService);
