export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export type ModelsDevModel = {
  id: string;
  pricing?: {
    input_cost_per_mtok?: number;
    output_cost_per_mtok?: number;
    cache_creation_cost_per_mtok?: number;
    cache_read_cost_per_mtok?: number;
  };
  [key: string]: unknown;
};

export type ModelsDevResponse = {
  data: ModelsDevModel[];
  [key: string]: unknown;
};

const DEFAULT_URL = "https://models.dev/api.json";

export async function fetchModelsDev(
  url: string = DEFAULT_URL,
): Promise<ModelsDevResponse> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new NetworkError(
      `Failed to fetch from ${url}: ${(err as Error).message}`,
      url,
    );
  }

  if (!response.ok) {
    throw new HttpError(response.status, url);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new ParseError(
      `Failed to parse JSON from ${url}: ${(err as Error).message}`,
      url,
    );
  }

  if (
    data === null ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !("data" in data)
  ) {
    throw new ParseError(
      `Response from ${url} does not have a "data" field`,
      url,
    );
  }

  const responseData = (data as Record<string, unknown>).data;
  if (!Array.isArray(responseData)) {
    throw new ParseError(
      `The "data" field in response from ${url} is not an array`,
      url,
    );
  }

  return data as ModelsDevResponse;
}
