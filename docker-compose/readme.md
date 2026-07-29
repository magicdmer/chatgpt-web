### docker-compose 部署教程
- 将 `docker-compose.yml` 放在独立部署目录中。
- 如需从宿主机加载插件，在同级创建 `plugins/`，并将插件目录放入其中；该目录会只读挂载到容器的 `/app/plugins`。
- 如果不需要宿主机插件，请删除 `docker-compose.yml` 中的 `./plugins:/app/plugins:ro` 挂载，使用镜像内置插件，避免空目录覆盖镜像内容。
- ```shell
  # 启动
  docker-compose up -d
  ```
- ```shell
  # 查看运行状态
  docker ps
  ```
- ```shell
  # 结束运行
  docker-compose down
  ```
