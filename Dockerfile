# syntax=docker/dockerfile:1

# ---- build: install all dependencies and build the Astro server bundle ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the husky "prepare" hook is for local git, not the image.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# ---- app: built output + production dependencies only ----
FROM node:22-slim AS app
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/entry.mjs"]

# ---- lambda: the same app plus the AWS Lambda Web Adapter (ADR-010) ----
# On Lambda the adapter turns each invocation into an ordinary HTTP request to
# the Node server. Built only when asked for (`--target lambda`, as the CDK
# stack does), so local and CI builds never depend on public.ecr.aws.
FROM app AS lambda
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter

# ---- default: plain `docker build .` gives the app image ----
FROM app
