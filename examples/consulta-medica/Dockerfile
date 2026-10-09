# Uma imagem por serviço: o build arg SERVICO escolhe qual arquivo de servicos/ ela executa.
# Contexto de build: a raiz do repositório.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY examples/consulta-medica/servicos ./servicos
ARG SERVICO
ENV SERVICO=${SERVICO}
USER node
CMD ["sh", "-c", "exec node servicos/${SERVICO}.mjs"]
