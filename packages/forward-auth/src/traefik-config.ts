export interface TraefikForwardAuthOptions {
  readonly serviceName: string;
  readonly forwardAuthUrl: string;
  readonly hosts: readonly string[] | string;
  readonly entryPoints?: readonly string[];
  readonly middlewareName?: string;
  readonly routerName?: string;
  readonly trustForwardHeader?: boolean;
  readonly authResponseHeaders?: readonly string[];
  readonly extraMiddlewares?: readonly string[];
  readonly decisionRoutes?: ReadonlyArray<TraefikDecisionRouteOptions>;
}

export interface TraefikDecisionRouteOptions {
  readonly pathPrefix: string;
  readonly upstreamUrl: string;
  readonly name?: string;
  readonly entryPoints?: readonly string[];
  readonly hosts?: readonly string[] | string;
  readonly middlewares?: readonly string[];
}

export interface TraefikForwardAuthConfig {
  readonly labels: readonly string[];
  readonly decisionRouters: readonly string[];
}

export const buildTraefikForwardAuthConfig = (
  options: TraefikForwardAuthOptions,
): TraefikForwardAuthConfig => {
  const routerName = options.routerName ?? sanitizeName(firstHost(options.hosts));
  const middlewareName = options.middlewareName ?? `${routerName}-forward-auth`;
  const hosts = toReadonlyArray(options.hosts);
  const rule = hosts.map((host) => `Host(\`${host}\`)`).join(" || ");
  const entryPoints = options.entryPoints?.length
    ? `traefik.http.routers.${routerName}.entrypoints=${options.entryPoints.join(",")}`
    : undefined;
  const middlewareList = [middlewareName, ...(options.extraMiddlewares ?? [])]
    .filter(Boolean)
    .join(",");

  const labels: string[] = [
    `traefik.http.routers.${routerName}.rule=${rule}`,
    `traefik.http.routers.${routerName}.service=${options.serviceName}`,
    `traefik.http.routers.${routerName}.middlewares=${middlewareList}`,
  ];
  if (entryPoints) {
    labels.push(entryPoints);
  }

  labels.push(
    `traefik.http.middlewares.${middlewareName}.forwardauth.address=${options.forwardAuthUrl}`,
  );
  if (options.trustForwardHeader ?? true) {
    labels.push(
      `traefik.http.middlewares.${middlewareName}.forwardauth.trustForwardHeader=true`,
    );
  }

  const normalizedHeaders = normalizeResponseHeaders(options.authResponseHeaders ?? []);
  if (normalizedHeaders.length > 0) {
    labels.push(
      `traefik.http.middlewares.${middlewareName}.forwardauth.authResponseHeaders=${normalizedHeaders.join(",")}`,
    );
  }

  const decisionRouters = (options.decisionRoutes ?? []).flatMap((route) =>
    buildDecisionRoute({
      route,
      fallbackHosts: hosts,
      routerName,
    }),
  );

  return { labels, decisionRouters };
};

interface BuildDecisionRouteInput {
  readonly route: TraefikDecisionRouteOptions;
  readonly routerName: string;
  readonly fallbackHosts: readonly string[];
}

const buildDecisionRoute = ({
  route,
  routerName,
  fallbackHosts,
}: BuildDecisionRouteInput): string[] => {
  const name = route.name ?? `${routerName}-${slugFromPath(route.pathPrefix)}`;
  const ruleHosts = toReadonlyArray(route.hosts ?? fallbackHosts);
  const rule = [
    ...ruleHosts.map((host) => `Host(\`${host}\`)`),
    `PathPrefix(\`${ensureLeadingSlash(route.pathPrefix)}\`)`,
  ].join(" && ");

  const labels: string[] = [
    `traefik.http.routers.${name}.rule=${rule}`,
    `traefik.http.routers.${name}.service=${name}`,
    `traefik.http.services.${name}.loadbalancer.server.url=${route.upstreamUrl}`,
  ];

  if (route.entryPoints?.length) {
    labels.push(`traefik.http.routers.${name}.entrypoints=${route.entryPoints.join(",")}`);
  }

  if (route.middlewares?.length) {
    labels.push(`traefik.http.routers.${name}.middlewares=${route.middlewares.join(",")}`);
  }

  return labels;
};

const sanitizeName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const slugFromPath = (value: string): string =>
  value
    .replace(/\/+$/, "")
    .replace(/^\/+/, "")
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .toLowerCase() || "decision";

const ensureLeadingSlash = (value: string): string => (value.startsWith("/") ? value : `/${value}`);

const normalizeResponseHeaders = (headers: readonly string[]): readonly string[] =>
  headers
    .map((header) => header.trim())
    .filter((header) => header.length > 0)
    .map((header) => header
      .split(/-/)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join("-"));

const toReadonlyArray = (input: readonly string[] | string): readonly string[] => {
  if (Array.isArray(input)) {
    return input;
  }
  return [input] as readonly string[];
};

const firstHost = (input: readonly string[] | string): string => {
  const hosts = toReadonlyArray(input);
  if (hosts.length === 0) {
    throw new Error("At least one host is required to build Traefik config");
  }
  return hosts[0];
};
