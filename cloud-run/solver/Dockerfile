FROM microfluidica/openfoam:13
USER root
RUN apt-get update && apt-get install -y --no-install-recommends nodejs ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/kythros
COPY worker.mjs ./worker.mjs
COPY template ./template
ENTRYPOINT ["node", "/opt/kythros/worker.mjs"]
