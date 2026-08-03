---
title: "用 Hugo + Amigo 搭了个静态博客"
date: "2026-02-20T20:00:00+08:00"
draft: false
author: ''
summary: ''
cover: ''
comments: true
categories: []
tags: []
---
啊
折腾了一下，用 Hugo 把博客搭起来了，主题选了 Amigo，还原了朋友圈的感觉。

几个优点：

- 纯静态，部署到任意平台都能跑
- 写作就是写 Markdown，很顺手
- 自带深色模式、图片灯箱、PJAX 无刷新

```bash
hugo new content posts/hello.md
hugo server -D
hugo            # 生成 public/
```

搭建完成，接下来就是坚持更新啦。
