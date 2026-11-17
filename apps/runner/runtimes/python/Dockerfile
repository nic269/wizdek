# Runtime for Python functions. Debian-based because many prebuilt wheels
# do not exist for musl.
FROM python:3.13-slim-bookworm

# Nothing outside /tmp is writable at run time.
ENV HOME=/tmp \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin fn

# Neither file may share a name with a standard-library module: Python puts
# a script's directory first on the import path unless told otherwise.
COPY wrapper.py read_params.py /opt/fn/

USER 10001:10001
WORKDIR /fn
