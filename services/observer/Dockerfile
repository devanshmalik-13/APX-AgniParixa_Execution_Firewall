FROM python:3.12-slim
WORKDIR /app
COPY requirements-torch.txt requirements.txt ./
RUN pip install --no-cache-dir -r requirements-torch.txt && pip install --no-cache-dir -r requirements.txt
COPY observer_service ./observer_service
RUN useradd --create-home observer
USER observer
ENV HF_HOME=/home/observer/.cache/huggingface OBSERVER_DEVICE=cpu OBSERVER_PRECISION=bfloat16 HF_HUB_DISABLE_XET=1
EXPOSE 8091
CMD ["python", "-m", "observer_service", "--host", "0.0.0.0"]
