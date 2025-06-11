export interface IServerResponse<T> {
  success: boolean;
  title?: string;
  message?: string;
  body: T;
}
