import argparse

import uvicorn

from .app import create_app


def main():
    parser = argparse.ArgumentParser(description="Run the authenticated APX advisory observer.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8091)
    arguments = parser.parse_args()
    # Request paths, bodies and headers are not logged. Keep one model-owning worker.
    uvicorn.run(create_app(), host=arguments.host, port=arguments.port, workers=1, access_log=False)


if __name__ == "__main__":
    main()
