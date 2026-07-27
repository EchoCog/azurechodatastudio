# Standalone container for the ZoneCog Python cognitive bridge (Phase 5.2).
#
# Build from the repository root so this can COPY the azure_integration
# package without an ADS/Node.js toolchain in the image:
#   docker build -f azure_integration/Dockerfile -t zonecog-bridge .
# Run:
#   docker run -p 7807:7807 zonecog-bridge
FROM python:3.11-slim

WORKDIR /app

COPY azure_integration/requirements.txt azure_integration/requirements.txt
RUN pip install --no-cache-dir -r azure_integration/requirements.txt

COPY azure_integration azure_integration

ENV HOST=0.0.0.0 \
    PORT=7807 \
    ATOMSPACE_MODE=mock

EXPOSE 7807

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["python", "-m", "azure_integration.healthcheck"]

ENTRYPOINT ["python", "-m", "azure_integration.cli"]
CMD ["serve"]
