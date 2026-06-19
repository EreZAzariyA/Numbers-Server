class ClientError {
  public status: number;
  public message: string;
  public payload?: Record<string, unknown>;

  public constructor(status: number, message: string, payload?: Record<string, unknown>) {
    this.status = status;
    this.message = message;
    this.payload = payload;
  };
};

export default ClientError;
