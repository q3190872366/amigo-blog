/**
 * 飞书私有同步机器人 - 通用版 (支持 R2 图床)
 * 通过环境变量配置: GITHUB_OWNER, GITHUB_CONTENT_REPO, GITHUB_CLIENT_REPO, GITHUB_WORKFLOW_ID, MOMENTS_FOLDER
 */
import { Hono } from 'hono';
import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

const app = new Hono();

// ============ 消息去重缓存 ============
const processedMessages = new Set();
function isMessageProcessed(messageId) {
	if (processedMessages.has(messageId)) return true;
	processedMessages.add(messageId);
	if (processedMessages.size > 100) processedMessages.clear();
	return false;
}

// ============ 仓库配置（通过环境变量设置） ============
const OWNER = 'YOUR_GITHUB_USERNAME';
const CONTENT_REPO = 'YOUR_CONTENT_REPO_NAME';
const CLIENT_REPO = 'YOUR_CLIENT_REPO_NAME';
const WORKFLOW_ID = 'YOUR_WORKFLOW_FILENAME.yml';

// Hugo 页面束根目录：每篇文章是 content/posts/<slug>/index.md + 同目录图片
const POSTS_DIR = 'content/posts';

function getRepoConfig(env) {
	return {
		owner: env.GITHUB_OWNER || OWNER,
		contentRepo: env.GITHUB_CONTENT_REPO || CONTENT_REPO,
		clientRepo: env.GITHUB_CLIENT_REPO || CLIENT_REPO,
		workflowId: env.GITHUB_WORKFLOW_ID || WORKFLOW_ID,
		// 内容仓库写操作统一走 master（与 CI 构建分支一致，避免默认分支漂移导致文章不同步）
		contentBranch: env.GITHUB_CONTENT_BRANCH || 'master',
	};
}

// ============ 飞书 API ============
async function sendFeishuMessage(env, openId, content) {
	const accessToken = await getFeishuToken(env);
	const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
		method: 'POST',
		headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ receive_id: openId, msg_type: 'text', content: JSON.stringify({ text: content }) })
	});
	if (!response.ok) console.error(`发送飞书消息失败: ${response.status}`);
}

const _tokenCache = { token: null, expiresAt: 0 };
async function getFeishuToken(env) {
	const now = Date.now();
	if (_tokenCache.token && now < _tokenCache.expiresAt) return _tokenCache.token;
	const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET })
	});
	const data = await response.json();
	if (data.code !== 0) throw new Error(`获取 Token 失败: ${data.msg}`);
	_tokenCache.token = data.tenant_access_token;
	_tokenCache.expiresAt = now + (data.expire - 60) * 1000;
	return _tokenCache.token;
}

async function getDocumentBlocks(token, documentId) {
	const allItems = [];
	let pageToken = '';
	do {
		const params = new URLSearchParams({ page_size: '500' });
		if (pageToken) params.set('page_token', pageToken);
		const response = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks?${params}`, {
			headers: { 'Authorization': `Bearer ${token}` }
		});
		const data = await response.json();
		if (data.code !== 0) throw new Error(`获取文档块失败: ${data.code} - ${data.msg}`);
		if (data.data?.items) allItems.push(...data.data.items);
		pageToken = data.data?.page_token || '';
	} while (pageToken);
	return { items: allItems };
}

async function listWikiNodes(token, spaceId) {
	const documents = [];
	let pageToken = '';
	try {
		do {
			const params = new URLSearchParams({ page_size: '50' });
			if (pageToken) params.set('page_token', pageToken);
			const response = await fetch(`https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes?${params}`, {
				headers: { 'Authorization': `Bearer ${token}` }
			});
			const data = await response.json();
			if (data.code !== 0 || !data.data?.items) break;
			for (const node of data.data.items) {
				if (node.node_type === 'origin' || node.node_type === 'document') {
					documents.push({ document_id: node.node_id, title: node.title, modified_time: parseInt(node.updated_at) });
				}
			}
			pageToken = data.data.page_token;
		} while (pageToken);
	} catch (error) { console.error('获取 Wiki 节点失败:', error); }
	return documents;
}

async function listAllFeishuDocuments(token, folderId) {
	const documents = [];
	let pageToken = '';
	do {
		const params = new URLSearchParams({ page_size: '50' });
		if (pageToken) params.set('page_token', pageToken);
		if (folderId) params.set('folder_token', folderId);
		const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?${params}`, {
			headers: { 'Authorization': `Bearer ${token}` }
		});
		const data = await response.json();
		if (data.code !== 0 || !data.data?.files) break;
		for (const file of data.data.files) {
			const docId = file.shortcut_info?.target_token || file.token;
			if (['doc', 'docx', 'shortcut'].includes(file.type)) {
				documents.push({ document_id: docId, title: file.name, modified_time: parseInt(file.modified_time) });
			}
		}
		pageToken = data.data.page_token;
	} while (pageToken);
	return documents;
}

async function findDocumentByTitle(title, token, env, folderId = env.FEISHU_FOLDER_ID) {
	const docs = await listAllFeishuDocuments(token, folderId);
	const lowerTitle = title.toLowerCase();
	return docs.find(d => d.title.toLowerCase().includes(lowerTitle)) || null;
}

async function findMomentDocumentByTitle(title, token, env) {
	return findDocumentByTitle(title, token, env, env.FEISHU_MOMENTS_FOLDER_ID);
}

// ============ 飞书块转 Markdown ============
const BLOCK_TYPE_MAP = { 1: 'page', 2: 'text', 3: 'heading1', 4: 'heading2', 5: 'heading3', 6: 'bullet', 7: 'ordered', 12: 'bullet', 14: 'code', 22: 'divider', 27: 'image' };

function extractPlainText(elements) { if (!elements) return ''; return elements.map(e => e.text_run?.content || '').join('').trim(); }

function extractInlineMarkdown(elements) {
	if (!elements) return '';
	let result = '';
	for (const el of elements) {
		if (el.text_run) {
			const style = el.text_run.text_element_style || {};
			let text = el.text_run.content || '';
			if (style.link) { result += `[${text}](${decodeURIComponent(style.link.url)})`; continue; }
			if (style.bold) result += '**'; if (style.italic) result += '*'; if (style.strikethrough) result += '~~'; if (style.inline_code) result += '`';
			result += text;
			if (style.inline_code) result += '`'; if (style.strikethrough) result += '~~'; if (style.italic) result += '*'; if (style.bold) result += '**';
		} else if (el.type === 'mention_user') { result += `@${el.mention_user?.name || '用户'}`; }
		else if (el.mention_doc) { result += `[${el.mention_doc.title || '文档'}](${el.mention_doc.url || '#'})`; }
		else if (el.type === 'equation') { result += `$${el.equation?.content || ''}$`; }
		else if (el.type === 'text_link') { result += `[${el.text_link?.text || ''}](${el.text_link?.url || '#'})`; }
	}
	return result.trim();
}

function normalizeQuotes(text) {
	return text.replace(/['']/g, "'").replace(/[""]/g, '"');
}

function extractText(block) {
	const process = (elements) => extractPlainText(elements);
	const elementTypes = ['text', 'page', 'bullet', 'table_cell', 'code', 'quote', 'callout'];
	let text = '';
	for (const type of elementTypes) {
		if (block[type]?.elements) { text = process(block[type].elements); if (text) break; }
	}
	if (!text) {
		['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'].forEach(type => {
			if (!text && block[type]?.elements) text = process(block[type].elements);
		});
	}
	return text;
}

function extractMarkdown(block) {
	const process = (elements) => extractInlineMarkdown(elements);
	const elementTypes = ['text', 'page', 'bullet', 'table_cell', 'code', 'quote', 'callout'];
	let text = '';
	for (const type of elementTypes) {
		if (block[type]?.elements) { text = process(block[type].elements); if (text) break; }
	}
	if (!text) {
		['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'].forEach(type => {
			if (!text && block[type]?.elements) text = process(block[type].elements);
		});
	}
	return text;
}

function parseControlBlock(blocksData) {
	const result = {};
	const pageBlock = blocksData.items.find(b => b.block_type === 1);
	if (!pageBlock?.children) return result;
	const controlLines = [];
	for (const childId of pageBlock.children) {
		const block = blocksData.items.find(b => b.block_id === childId);
		if (!block) continue;
		if (block.block_type >= 3 && block.block_type <= 5) break;
		if (block.block_type === 2) { const text = extractText(block); if (text) controlLines.push(text); }
	}
	const ct = controlLines.join('|');
	if (ct.includes('分类')) { const m = ct.match(/分类[:：]\s*([^|]+?)(?=\|标签|$)/); if (m) result.category = m[1].trim(); }
	if (ct.includes('标签')) { const m = ct.match(/标签[:：]\s*([^|]+?)(?=\|分类|$)/); if (m) result.tags = m[1].split(',').map(t => t.trim()).filter(t => t); }
	if (ct.includes('草稿')) { const m = ct.match(/草稿[:：]\s*(.+?)(?=分类|标签|$)/); if (m) result.draft = m[1].trim().toLowerCase() === 'true'; }
	if (ct.includes('title')) { const m = ct.match(/title[:：]\s*(.+?)(?=分类[:：]|标签[:：]|$)/); if (m) result.title = m[1].trim(); }
	if (ct.includes('置顶')) { const m = ct.match(/置顶[:：]\s*(.+?)(?=分类[:：]|标签[:：]|$)/); if (m) result.pinned = m[1].trim().toLowerCase() === 'true'; }
	return result;
}

// GitHub Contents API 的路径：必须保留 `/` 分隔符，只对每一段做编码。
// 直接用 encodeURIComponent(整条路径) 会把 `/` 变成 %2F，导致 404。
function ghPath(p) {
	return String(p).split('/').map(encodeURIComponent).join('/');
}

// 生成 Amigo 主题认识的 front matter。
// 字段依据 themes/Amigo/layouts：cover / images / comments / author / categories / tags。
// cover 与正文图片都用「裸文件名」，Hugo 会通过 .Resources.GetMatch 在页面束内解析。
function buildFrontmatter({ title, date, tags, category, description, cover, draft, isLongArticle }) {
	const q = (str) => JSON.stringify(String(str == null ? '' : str).trim());
	const yamlList = (items) => (items && items.length)
		? '\n' + items.map((t) => `  - ${q(t)}`).join('\n')
		: ' []';
	const cats = category ? [category] : [];
	const lines = [
		'---',
		`title: ${q(title)}`,
		`date: ${q(date)}`,
		`draft: ${draft === true ? 'true' : 'false'}`,
		`author: ''`,
		`summary: ${q(description)}`,
		`cover: ${q(cover || '')}`,
		`comments: true`,
		`categories:${yamlList(cats)}`,
		`tags:${yamlList(tags)}`,
	];
	if (isLongArticle) lines.push('isLongArticle: true');
	lines.push('---', '');
	return lines.join('\n');
}

// ============ 飞书图片处理 ============
function extractImagesFromBlocks(blocksData) {
	const images = [], externalUrls = [];
	function processBlock(block) {
		if ((block.block_type === 11 || block.block_type === 27) && block.image?.token) images.push({ token: block.image.token, block_id: block.block_id });
		if (block.block_type === 2 && block.text) {
			const text = block.text?.elements?.map(e => e.text_run?.content || '').join('') || '';
			const urlRegex = /https?:\/\/[^\s<>"\]]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s<>"\]]*)?/gi;
			let match; while ((match = urlRegex.exec(text)) !== null) { if (!externalUrls.includes(match[0])) externalUrls.push(match[0]); }
		}
		if (block.children) { for (const childId of block.children) { const child = blocksData.items?.find(b => b.block_id === childId); if (child) processBlock(child); } }
	}
	if (blocksData.items) for (const block of blocksData.items) processBlock(block);
	return { feishuImages: images, externalUrls };
}

async function downloadFeishuImage(token, imageToken) {
	const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/medias/${imageToken}/download`, { headers: { 'Authorization': `Bearer ${token}` } });
	if (!response.ok) throw new Error(`下载图片失败: ${response.status}`);
	const buffer = await response.arrayBuffer();
	const contentType = response.headers.get('content-type') || 'image/png';
	const ext = (contentType.split('/')[1]?.split(';')[0] || 'png') === 'jpeg' ? 'jpg' : contentType.split('/')[1]?.split(';')[0] || 'png';
	return { buffer, ext, contentType };
}

function uint8ArrayToBase64(uint8Array) { const buf = new Uint8Array(uint8Array); let binary = ''; for (let i = 0; i < buf.byteLength; i++) binary += String.fromCharCode(buf[i]); return Buffer.from(binary, 'binary').toString('base64'); }

// 图片作为「页面束资源」上传到文章自己的目录 content/posts/<slug>/<filename>，
// 返回裸文件名，正文里用 ![](filename) 引用，Amigo 主题会用 Resources.GetMatch 解析。
async function uploadImageToGitHub(imageBuffer, filename, env, slug) {
	const { owner, contentRepo, contentBranch } = getRepoConfig(env);
	const path = slug ? `${POSTS_DIR}/${slug}/${filename}` : `static/posts/images/${filename}`;
	let sha = null;
	const shaResp = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${ghPath(path)}`, {
		headers: { 'Cache-Control': 'no-cache', 'Authorization': `Bearer ${env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
	});
	if (shaResp.ok) sha = (await shaResp.json()).sha;
	const uploadResp = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${ghPath(path)}`, {
		method: 'PUT',
		headers: { 'Authorization': `Bearer ${env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'feishu-sync-bot' },
		body: JSON.stringify({ message: `sync: upload ${filename}`, content: uint8ArrayToBase64(new Uint8Array(imageBuffer)), branch: contentBranch, ...(sha ? { sha } : {}) })
	});
	if (!uploadResp.ok) throw new Error(`上传图片失败: ${(await uploadResp.json()).message}`);
	return slug ? filename : `/posts/images/${filename}`;
}

async function uploadImageToR2(imageBuffer, filename, env) {
	if (!env.IMG_BUCKET) throw new Error('未绑定 R2 Bucket');
	if (!env.R2_PUBLIC_URL) throw new Error('未配置 R2 公开访问域名');
	const contentType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
	const key = `posts/images/${filename}`;
	await env.IMG_BUCKET.put(key, imageBuffer, { httpMetadata: { contentType } });
	return `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
}

async function processDocumentImages(token, blocksData, env, slug) {
	const { feishuImages, externalUrls } = extractImagesFromBlocks(blocksData);
	const imageMap = new Map();
	const useR2 = !!env.IMG_BUCKET && !!env.R2_PUBLIC_URL;
	for (const img of feishuImages) {
		try {
			const { buffer, ext } = await downloadFeishuImage(token, img.token);
			const filename = `${img.token}.${ext}`;
			let url;
			if (useR2) { try { url = await uploadImageToR2(buffer, filename, env); } catch (e) { console.error(`R2上传失败，fallback到GitHub: ${e.message}`); url = await uploadImageToGitHub(buffer, filename, env, slug); } }
			else { url = await uploadImageToGitHub(buffer, filename, env, slug); }
			imageMap.set(img.token, url);
		} catch (e) { console.error(`处理图片失败 ${img.token}:`, e.message); }
	}
	for (const url of externalUrls) imageMap.set(`ext_${url}`, url);
	return imageMap;
}

// ============ 文档转 Markdown 核心 ============
function documentToMarkdown(blocksData, imageMap = new Map()) {
	if (!blocksData?.items) throw new Error('获取文档块失败');
	const blockMap = new Map();
	for (const block of blocksData.items) blockMap.set(block.block_id, block);
	let markdown = '';
	const pageBlock = blocksData.items.find(b => b.block_type === 1);
	const rootBlockIds = pageBlock?.children || [];
	let orderedCounter = 0;

	function processBlock(blockId, level = 0) {
		const block = blockMap.get(blockId);
		if (!block || block.block_type === 1) return;
		const type = BLOCK_TYPE_MAP[block.block_type] || 'text';
		const text = extractMarkdown(block);
		const indent = ' '.repeat(level);
		if (type.startsWith('heading')) { markdown += `${'#'.repeat(parseInt(type.replace('heading', '')))} ${text}\n\n`; return; }
		if (type === 'bullet' && text) { markdown += `${indent}- ${text}\n`; }
		else if (type === 'ordered') { markdown += `${indent}${++orderedCounter}. ${text}\n`; }
		else if (type === 'todo' && text) { markdown += `${indent}- [${block.todo?.style === 'done' ? 'x' : ' '}] ${text}\n`; }
		else if (type === 'code') {
			const lang = String(block.code?.style?.language || block.block_code?.style?.language || '').toLowerCase();
			const codeElements = block.code?.elements || block.block_code?.elements || [];
			const codeText = extractInlineMarkdown(codeElements);
			markdown += "\`\`\`" + lang + "\n" + normalizeQuotes(codeText) + "\n\`\`\`\n\n";
			return;
		}
		else if (type === 'quote') { markdown += `${indent}> ${text}\n\n`; if (block.children) { for (const childId of block.children) processBlock(childId, level + 1); } return; }
		else if (type === 'divider') { markdown += `***\n\n`; return; }
		else if (type === 'image') { const imgToken = block.image?.token; if (imgToken && imageMap.has(imgToken)) markdown += `![](${imageMap.get(imgToken)})\n\n`; return; }
		else if (type === 'table') {
			if (block.children?.length > 0) {
				const columnSize = block.property?.table?.column_size || 0;
				let tableMd = '';
				if (columnSize > 0) {
					let rowIndex = -1;
					for (let i = 0; i < block.children.length; i++) {
						if (i % columnSize === 0) { rowIndex++; tableMd += '| '; }
						const cellBlock = blockMap.get(block.children[i]);
						tableMd += `${cellBlock ? extractMarkdown(cellBlock) : ' '} |`;
						if ((i + 1) % columnSize === 0) {
							tableMd += '\n';
							if (rowIndex === 0) tableMd += `| ${Array(columnSize).fill('---').join(' | ')} |\n`;
						}
					}
					markdown += tableMd + '\n';
				}
			}
			return;
		}
		else if (type === 'text' && text) {
			let filteredText = text.split('\n').filter(line => !line.match(/^(分类|标签|title|filename|draft)[:：]\s*/)).join('\n').trim();
			if (imageMap.size > 0) { filteredText = filteredText.replace(/https?:\/\/[^\s<>"\]]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?[^\s<>"\]]*)?/gi, (url) => imageMap.has(`ext_${url}`) ? `![](${url})` : url); }
			if (filteredText) markdown += `${filteredText}\n\n`;
		}
		if (block.children && ['bullet', 'ordered', 'todo', 'quote'].includes(type)) { for (const childId of block.children) processBlock(childId, level + 1); }
	}
	for (const blockId of rootBlockIds) { processBlock(blockId, 0); }
	return markdown;
}

// ============ GitHub API ============
async function triggerGitHubWorkflow(env) {
	// 等待 3 秒，确保所有 commit 已在 GitHub 端完成（避免 checkout 到一半的仓库）
	await new Promise(resolve => setTimeout(resolve, 3000));
	const { owner, clientRepo, workflowId } = getRepoConfig(env);
	const branch = env.GITHUB_CLIENT_BRANCH || 'master';
	const response = await fetch(`https://api.github.com/repos/${owner}/${clientRepo}/actions/workflows/${workflowId}/dispatches`, {
		method: 'POST', headers: { 'Authorization': `Bearer ${env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'feishu-sync-bot' },
		body: JSON.stringify({ ref: branch })
	});
	if (!response.ok) throw new Error(`GitHub API 错误: ${await response.text()}`);
}

async function getFileSha(path, token, env) {
	const { owner, contentRepo } = getRepoConfig(env);
	const r = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${ghPath(path)}`, { headers: { 'Cache-Control': 'no-cache', 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' } });
	if (r.status === 404) return null;
	return (await r.json()).sha;
}

async function updateSiteContentFile(path, content, env) {
	const { owner, contentRepo, contentBranch } = getRepoConfig(env);
	const sha = await getFileSha(path, env.GITHUB_PAT, env);
	const r = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${ghPath(path)}`, {
		method: 'PUT', headers: { 'Authorization': `Bearer ${env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'feishu-sync-bot' },
		body: JSON.stringify({ message: `sync: ${path}`, content: Buffer.from(content, 'utf-8').toString('base64'), branch: contentBranch, ...(sha ? { sha } : {}) })
	});
	if (!r.ok) throw new Error(`更新失败: ${(await r.json()).message}`);
}


async function updateMomentsFile(filename, content, env) {
	const { owner, contentRepo, contentBranch } = getRepoConfig(env);
	const momentsFolder = env.MOMENTS_FOLDER || 'moments';
	const path = `${momentsFolder}/${filename}`;
	const sha = await getFileSha(path, env.GITHUB_PAT, env);
	const r = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${path}`, {
		method: 'PUT', headers: { 'Authorization': `Bearer ${env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'feishu-sync-bot' },
		body: JSON.stringify({ message: `sync: ${filename}`, content: Buffer.from(content, 'utf-8').toString('base64'), branch: contentBranch, ...(sha ? { sha } : {}) })
	});
	if (!r.ok) throw new Error(`更新说说失败: ${(await r.json()).message}`);
}

// ============ GitHub 搜索与删除 ============
// Hugo 页面束：content/posts 下每个子目录是一篇文章，正文固定为 index.md。
// 同时兼容历史上的扁平 content/posts/xxx.md。
async function listPostsFiles(token, env) {
	const { owner, contentRepo } = getRepoConfig(env);
	const response = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${ghPath(POSTS_DIR)}`, {
		headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
	});
	if (response.status === 404) return [];
	if (!response.ok) throw new Error(`列出文件失败: ${response.status}`);
	const data = await response.json();
	const out = [];
	for (const f of data || []) {
		if (f.type === 'dir') out.push({ path: `${f.path}/index.md`, dir: f.path, name: f.name, sha: null });
		else if (f.name.endsWith('.md')) out.push({ path: f.path, dir: null, name: f.name, sha: f.sha });
	}
	return out;
}

// 删除整篇文章：页面束要连同目录里的图片一起删掉，否则会残留孤儿资源。
async function deletePostTarget(target, token, env) {
	const { owner, contentRepo } = getRepoConfig(env);
	if (!target.dir) {
		await deleteFile(target.path, target.sha, token, env);
		return 1;
	}
	const resp = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${ghPath(target.dir)}`, {
		headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
	});
	if (!resp.ok) throw new Error(`读取文章目录失败: ${resp.status}`);
	const files = await resp.json();
	let n = 0;
	for (const f of files) {
		if (f.type !== 'file') continue;
		await deleteFile(f.path, f.sha, token, env);
		n++;
	}
	return n;
}

async function listMomentsFiles(token, env) {
	const { owner, contentRepo } = getRepoConfig(env);
	const momentsFolder = env.MOMENTS_FOLDER || 'moments';
	const response = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${momentsFolder}`, {
		headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
	});
	if (response.status === 404) return [];
	if (!response.ok) throw new Error(`列出说说文件失败: ${response.status}`);
	const data = await response.json();
	return (data || []).filter(f => f.name.endsWith('.md')).map(f => ({ path: f.path, name: f.name, sha: f.sha }));
}

async function listPhotosFiles(token, env) {
	const { owner, contentRepo } = getRepoConfig(env);
	const response = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/photos`, {
		headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
	});
	if (response.status === 404) return [];
	if (!response.ok) throw new Error(`列出相册文件失败: ${response.status}`);
	const data = await response.json();
	return (data || []).filter(f => f.type === 'dir').map(f => ({ path: f.path, name: f.name, sha: null }));
}

function parseFrontmatterTitle(content) {
	const match = content.match(/^---\s*\ntitle:\s*(.+?)\s*\n/);
	return match ? match[1].replace(/^["']|["']$/g, '').trim() : '';
}

// 生成 Hugo/Amigo 友好的 slug（保留中文，其它非单词字符转连字符）
function slugify(str) {
	return String(str).toLowerCase().trim()
		.replace(/[^\w一-龥]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.substring(0, 60) || 'post';
}

function extractDocIdFromFilename(filename) {
	const match = filename.match(/^[\d-]+-(.+)\.md$/);
	return match ? match[1] : '';
}

async function searchFilesByTitle(title, token, env, folder = 'posts') {
	let files;
	const momentsFolder = env.MOMENTS_FOLDER || 'moments';
	if (folder === 'moments') {
		files = await listMomentsFiles(token, env);
	} else if (folder === 'photos') {
		files = await listPhotosFiles(token, env);
	} else {
		files = await listPostsFiles(token, env);
	}
	const results = [];
	const lowerTitle = title.toLowerCase();
	for (const file of files) {
		try {
			let filePath = file.path;
			let fileInfo;
			if (folder === 'photos') {
				filePath = `${file.path}/index.md`;
				fileInfo = await getFileInfo(filePath, token, env);
			} else {
				fileInfo = await getFileInfo(file.path, token, env);
			}
			if (!fileInfo || !fileInfo.content) continue;
			const content = Buffer.from(fileInfo.content, 'base64').toString('utf-8');
			const fileTitle = parseFrontmatterTitle(content);
			const fileLower = fileTitle.toLowerCase();
			if (fileLower.includes(lowerTitle)) {
				results.push({
					path: filePath,
					dir: folder === 'photos' ? file.path : (file.dir || null),
					name: fileTitle || file.name,
					sha: fileInfo.sha,
					docId: extractDocIdFromFilename(file.name) || file.name
				});
			}
		} catch (e) {
			console.error(`读取文件失败 ${file.path}:`, e.message);
		}
	}
	return results;
}

async function getFileInfo(path, token, env) {
	const { owner, contentRepo } = getRepoConfig(env);
	const encodedPath = ghPath(path);
	const response = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${encodedPath}`, {
		headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`获取文件信息失败: ${response.status}`);
	return await response.json();
}

async function deleteFile(path, sha, token, env) {
	const { owner, contentRepo, contentBranch } = getRepoConfig(env);
	const response = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${ghPath(path)}`, {
		method: 'DELETE',
		headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'feishu-sync-bot' },
		body: JSON.stringify({ message: `delete: ${path}`, sha, branch: contentBranch })
	});
	if (!response.ok) throw new Error(`删除失败: ${(await response.json()).message}`);
}

// ============ 待确认删除状态（KV） ============
const _PENDING_KEY_PREFIX = 'pending_delete';
function _pendingDeleteKey(openId) { return `${_PENDING_KEY_PREFIX}:${openId}`; }
async function setPendingDelete(env, openId, info) { await env.PENDING_KV.put(_pendingDeleteKey(openId), JSON.stringify(info), { expirationTtl: 300 }); }
async function getPendingDelete(env, openId) { const val = await env.PENDING_KV.get(_pendingDeleteKey(openId)); return val ? JSON.parse(val) : null; }
async function clearPendingDelete(env, openId) { await env.PENDING_KV.delete(_pendingDeleteKey(openId)); }

// ============ 飞书验签 ============
async function verifySignature(signature, timestamp, body, env) {
	if (!env.FEISHU_SIGNING_SECRET) return true;
	return signature === createHmac('sha256', env.FEISHU_SIGNING_SECRET).update(timestamp + env.FEISHU_SIGNING_SECRET + body).digest('hex');
}

// ============ 核心同步逻辑 ============

async function executeSync(documentId, env, token, docTitle, modified_time) {
	const { owner, contentRepo } = getRepoConfig(env);
	const blocksData = await getDocumentBlocks(token, documentId);
	const control = parseControlBlock(blocksData);
	const dateStr = modified_time ? new Date(modified_time * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
	// Amigo 主题要求 content/posts/<slug>/index.md；slug 优先用控制块 filename，否则用标题转写
	const slug = control.filename ? control.filename : (docTitle ? slugify(docTitle) : documentId);
	const filename = `${slug}.md`;
	const path = `${POSTS_DIR}/${slug}/index.md`;
	const encodedPath = ghPath(path);

	const fileResp = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${encodedPath}`, {
		headers: { 'Authorization': `Bearer ${env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
	});
	if (fileResp.status === 404) {
		// 文件不存在，继续同步
	} else if (fileResp.ok) {
		const commitsResp = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/commits?path=${encodedPath}&per_page=1`, {
			headers: { 'Authorization': `Bearer ${env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
		});
		let githubDate = 0;
		if (commitsResp.ok) {
			const commits = await commitsResp.json();
			if (commits?.[0]?.commit?.author?.date) {
				githubDate = new Date(commits[0].commit.author.date).getTime();
			}
		}
		if (githubDate >= modified_time * 1000) {
			return { title: docTitle, filename, status: 'skipped' };
		}
	}

	// 图片先传进本文章的页面束目录，正文再用裸文件名引用
	const imageMap = await processDocumentImages(token, blocksData, env, slug);
	const markdown = documentToMarkdown(blocksData, imageMap);
	const date = modified_time ? new Date(modified_time * 1000).toISOString() : new Date().toISOString();
	const titleMatch = markdown.match(/^#\s+(.+)\n/);
	const title = control.title || titleMatch?.[1] || docTitle || '未命名文档';
	const description = markdown.replace(/^#.*\n/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().substring(0, 150);
	// 封面取第一张图（页面束内为裸文件名，R2 模式下为 http 链接）
	const cover = [...imageMap.values()][0] || '';
	const frontmatter = buildFrontmatter({ title, date, tags: control.tags, category: control.category, description, cover, draft: control.draft, isLongArticle: control.pinned });
	await updateSiteContentFile(path, frontmatter + markdown, env);
	return { title, filename, status: 'success' };
}

async function syncAllDocuments(env) {
	const token = await getFeishuToken(env);
	const docs = env.FEISHU_WIKI_SPACE_ID ? await listWikiNodes(token, env.FEISHU_WIKI_SPACE_ID) : (env.FEISHU_FOLDER_ID ? await listAllFeishuDocuments(token, env.FEISHU_FOLDER_ID) : []);
	if (!docs.length) throw new Error('未找到任何飞书文档');
	const successTitles = [], skippedTitles = [];
	for (const doc of docs) {
		const res = await executeSync(doc.document_id, env, token, doc.title, doc.modified_time);
		if (res.status === 'success') successTitles.push(res.title);
		else if (res.status === 'skipped') skippedTitles.push(res.title);
	}
	let msg = '';
	if (successTitles.length) msg += `✅ 推送成功 (${successTitles.length}):\n${successTitles.map(t => `• ${t}`).join('\n')}\n`;
	if (skippedTitles.length) msg += `⏭️ 跳过 (${skippedTitles.length}): ${skippedTitles.join(', ')}`;
	return { msg: msg || '没有需要同步的文档', hasSuccess: successTitles.length > 0 };
}

async function syncDocumentById(documentId, env) {
	const token = await getFeishuToken(env);
	const docResp = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`, {
		headers: { 'Authorization': `Bearer ${token}` }
	}).then(r => r.json());
	const doc = docResp.data?.document;
	if (!doc) throw new Error('获取文档信息失败');
	const modified_time = Math.floor(new Date(doc.modified_time).getTime() / 1000);
	const res = await executeSync(documentId, env, token, doc.title, modified_time);
	return { title: res.title, status: res.status, msg: res.status === 'success' ? `单篇同步成功: ${res.title}` : '该文档状态异常或未更新' };
}

// ============ 说说同步 ============
function extractMomentIdFromFilename(filename) {
	const match = filename.match(/^[\d-]+-(.+)\.md$/);
	return match ? match[1] : '';
}

async function executeSyncMoment(documentId, env, token, docTitle, modified_time) {
	const { owner, contentRepo } = getRepoConfig(env);
	const momentsFolder = env.MOMENTS_FOLDER || 'moments';
	const blocksData = await getDocumentBlocks(token, documentId);
	const dateStr = modified_time ? new Date(modified_time * 1000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
	const filename = `${dateStr}-${documentId}.md`;
	const path = `${momentsFolder}/${filename}`;
	const encodedPath = ghPath(path);

	const fileResp = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${encodedPath}`, {
		headers: { 'Authorization': `Bearer ${env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
	});
	if (fileResp.status === 404) {
		// 文件不存在，继续
	} else if (fileResp.ok) {
		const commitsResp = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/commits?path=${encodedPath}&per_page=1`, {
			headers: { 'Authorization': `Bearer ${env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
		});
		let githubDate = 0;
		if (commitsResp.ok) {
			const commits = await commitsResp.json();
			if (commits?.[0]?.commit?.author?.date) {
				githubDate = new Date(commits[0].commit.author.date).getTime();
			}
		}
		if (githubDate >= modified_time * 1000) {
			return { title: docTitle, filename, status: 'skipped' };
		}
	}

	const imageMap = await processDocumentImages(token, blocksData, env);

	let markdown = '';
	const pageBlock = blocksData.items.find(b => b.block_type === 1);
	const rootBlockIds = pageBlock?.children || [];

	function processBlock(blockId) {
		const block = blocksData.items.find(b => b.block_id === blockId);
		if (!block || block.block_type === 1) return;

		if (block.block_type === 2 && block.text?.elements) {
			for (const el of block.text.elements) {
				if (el.text_run) {
					let text = el.text_run.content || '';
					const style = el.text_run.text_element_style || {};
					if (style.link) text = `[${text}](${decodeURIComponent(style.link.url)})`;
					markdown += text;
				} else if (el.type === 'text_link') {
					markdown += `[${el.text_link?.text || ''}](${el.text_link?.url || '#'})`;
				}
			}
			markdown += '\n';
		} else if ((block.block_type === 11 || block.block_type === 27) && block.image?.token) {
			const imgToken = block.image.token;
			if (imageMap.has(imgToken)) {
				markdown += `\n![](${imageMap.get(imgToken)})\n`;
			}
		}

		if (block.children) {
			for (const childId of block.children) processBlock(childId);
		}
	}

	for (const blockId of rootBlockIds) processBlock(blockId);

	const id = `${dateStr}-${documentId}`;
	const date = modified_time ? new Date(modified_time * 1000).toISOString() : new Date().toISOString();
	const frontmatter = `---\ntitle: ${docTitle}\nid: ${id}\ndate: ${date}\n---\n\n`;

	await updateMomentsFile(filename, frontmatter + markdown.trim(), env);
	return { title: docTitle, filename, status: 'success' };
}

async function syncAllMoments(env) {
	if (!env.FEISHU_MOMENTS_FOLDER_ID) throw new Error('未配置说说文件夹 ID');
	const token = await getFeishuToken(env);
	const docs = await listAllFeishuDocuments(token, env.FEISHU_MOMENTS_FOLDER_ID);
	if (!docs.length) throw new Error('未找到任何说说文档');

	const successTitles = [], skippedTitles = [];
	for (const doc of docs) {
		const res = await executeSyncMoment(doc.document_id, env, token, doc.title, doc.modified_time);
		if (res.status === 'success') successTitles.push(res.title);
		else if (res.status === 'skipped') skippedTitles.push(res.title);
	}

	let msg = '';
	if (successTitles.length) msg += `✅ 说说推送成功 (${successTitles.length}):\n${successTitles.map(t => `• ${t}`).join('\n')}\n`;
	if (skippedTitles.length) msg += `⏭️ 跳过 (${skippedTitles.length}): ${skippedTitles.join(', ')}`;
	return { msg: msg || '没有需要同步的说说', hasSuccess: successTitles.length > 0 };
}

async function syncMomentById(documentId, env) {
	const token = await getFeishuToken(env);
	const docResp = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}`, {
		headers: { 'Authorization': `Bearer ${token}` }
	}).then(r => r.json());
	const doc = docResp.data?.document;
	if (!doc) throw new Error('获取说说文档信息失败');
	const modified_time = Math.floor(new Date(doc.modified_time).getTime() / 1000);
	const res = await executeSyncMoment(documentId, env, token, doc.title, modified_time);
	return { title: res.title, status: res.status, msg: res.status === 'success' ? `同步说说成功: ${res.title}` : '该说说状态异常或未更新' };
}

// ============ 路由 ============
app.get('/health', (c) => c.json({ status: 'ok' }));
app.get('/webhook/feishu', async (c) => { const challenge = c.req.query('challenge'); return challenge ? c.json({ challenge }) : c.json({ code: 404 }, 404); });

// 调试端点：验证飞书连接 + 列出待同步文档
app.get('/debug/feishu-status', async (c) => {
	try {
		const token = await getFeishuToken(c.env);
		// 测试 token 换取
		const listResp = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${c.env.FEISHU_FOLDER_ID}&page_size=10`, {
			headers: { 'Authorization': `Bearer ${token}` }
		});
		const listData = await listResp.json();
		// 获取文件夹信息
		const folderResp = await fetch(`https://open.feishu.cn/open-apis/drive/v1/metas/batch_query`, {
			method: 'POST',
			headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ request_docs: [{ doc_token: c.env.FEISHU_FOLDER_ID, doc_type: 'folder' }] })
		});
		const folderData = await folderResp.json();
		return c.json({
			token_ok: listData.code === 0 || listData.code === 1061002,
			list_code: listData.code,
			list_msg: listData.msg,
			file_count: listData.data?.files?.length || 0,
			files: (listData.data?.files || []).map(f => ({ name: f.name, type: f.type, token: f.token })),
			folder_info: folderData.data?.metas?.[0] || null,
			has_github_pat: !!c.env.GITHUB_PAT,
			has_github_owner: !!c.env.GITHUB_OWNER,
			has_github_content_repo: !!c.env.GITHUB_CONTENT_REPO,
		});
	} catch (e) {
		return c.json({ error: e.message }, 500);
	}
});

// 调试端点：直接触发全量同步（无需飞书事件）
app.get('/debug/test-sync', async (c) => {
	try {
		const result = await syncAllDocuments(c.env);
		if (result.hasSuccess) {
			await triggerGitHubWorkflow(c.env);
			return c.json({ success: true, ...result, workflow_triggered: true });
		}
		return c.json({ success: false, ...result });
	} catch (e) {
		return c.json({ error: e.message, stack: e.stack }, 500);
	}
});

// 调试端点：读取最近收到的 webhook 事件日志
app.get('/debug/last-event', async (c) => {
	try {
		const raw = await c.env.PENDING_KV.get('_debug_event');
		return c.json(raw ? JSON.parse(raw) : { status: 'no events yet' });
	} catch (e) {
		return c.json({ error: e.message }, 500);
	}
});

app.post('/webhook/feishu', async (c) => {
	const log = (step, detail) => {
		c.executionCtx.waitUntil((async () => {
			try {
				await c.env.PENDING_KV.put('_debug_event', JSON.stringify({ step, detail, time: new Date().toISOString() }), { expirationTtl: 300 });
			} catch (_) {}
		})());
	};
	try {
		const signature = c.req.header('x-lark-signature');
		const timestamp = c.req.header('x-lark-timestamp');
		const body = await c.req.text();
		const data = JSON.parse(body);
		if (data.challenge) { log('challenge', 'received'); return c.json({ challenge: data.challenge }); }
		if (!body) { log('empty', 'no body'); return c.json({ code: 0 }); }
		const sigOk = await verifySignature(signature, timestamp, body, c.env);
		if (!sigOk) { log('sig_fail', 'signature verification failed'); return c.json({ code: 401 }, 401); }

		log('event_rcv', { type: data.header?.event_type || data.event?.type, sender_type: data.event?.sender?.sender_type });

		const messageId = data.event?.message?.message_id || '';
		if (messageId && isMessageProcessed(messageId)) return c.json({ code: 0 });

		let messageContent = '';
		try { messageContent = JSON.parse(data.event?.message?.content || '{}').text || ''; } catch (e) {}
		const userOpenId = data.event?.sender?.sender_id?.open_id || '';
		const text = messageContent.trim();

		if (text === '同步' || text === 'sync' || text === '同步文章' || text === '同步文档') {
			c.executionCtx.waitUntil((async () => {
				try {
					const { msg, hasSuccess } = await syncAllDocuments(c.env);
					if (hasSuccess) {
						await triggerGitHubWorkflow(c.env);
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `✅ ${msg}\n🚀 已触发博客重新构建。`);
					} else {
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `⏭️ ${msg}`);
					}
				} catch (error) {
					console.error('同步失败:', error);
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 全量同步失败: ${error.message}`);
				}
			})());
			return c.json({ code: 0 });
		} else if (text.startsWith('同步 ') || (text.match(/^同步[^\s=]/) && !text.startsWith('同步文章') && !text.startsWith('同步文档') && !text.startsWith('同步说说'))) {
			// 支持 "同步 标题" 和 "同步标题" 两种格式（同步后紧跟非空白字符即为标题）
			const documentId = text.substring(3).trim();
			c.executionCtx.waitUntil((async () => {
				try {
					let docId = documentId;
					if (documentId.match(/[一-龥]/)) {
						const token = await getFeishuToken(c.env);
						const docInfo = await findDocumentByTitle(documentId, token, c.env);
						if (!docInfo) {
							if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 未找到包含「${documentId}」的文档`);
							return;
						}
						docId = docInfo.document_id;
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `📄 找到文档: ${docInfo.title}，开始同步...`);
					}
					const { msg, status } = await syncDocumentById(docId, c.env);
					if (status === 'success') {
						await triggerGitHubWorkflow(c.env);
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `✅ ${msg}\n🚀 已触发博客重新构建。`);
					} else {
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `⏭️ ${msg}`);
					}
				} catch (error) {
					console.error('同步失败:', error);
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 单篇同步失败: ${error.message}`);
				}
			})());
			return c.json({ code: 0 });
		} else if (text.startsWith('删除 ')) {
			const title = text.substring(3).trim();
			c.executionCtx.waitUntil((async () => {
				try {
					const results = await searchFilesByTitle(title, c.env.GITHUB_PAT, c.env);
					if (results.length === 0) {
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 未找到包含「${title}」的文章`);
						return;
					}
					if (results.length > 1) {
						const list = results.map(r => `• ${r.name} (ID: ${r.docId})`).join('\n');
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `找到多篇文章，请精确标题：\n${list}`);
						return;
					}
					const file = results[0];
					await setPendingDelete(c.env, userOpenId, { path: file.path, dir: file.dir, sha: file.sha, name: file.name, docId: file.docId });
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `确认删除《${file.name}》（目录: ${file.docId}）？\n回复 Y 确认删除`);
				} catch (error) {
					console.error('删除搜索失败:', error);
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 删除失败: ${error.message}`);
				}
			})());
			return c.json({ code: 0 });
		} else if (text === 'Y' || text === 'y' || text === '确认' || text === '确认删除') {
			c.executionCtx.waitUntil((async () => {
				try {
					const pending = await getPendingDelete(c.env, userOpenId);
					if (!pending) {
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 没有待确认的删除操作`);
						return;
					}
					const removed = await deletePostTarget(pending, c.env.GITHUB_PAT, c.env);
					await clearPendingDelete(c.env, userOpenId);
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `✅ 已删除《${pending.name}》，共移除 ${removed} 个文件\n🚀 已触发博客重新构建。`);
					await triggerGitHubWorkflow(c.env);
				} catch (error) {
					console.error('删除确认失败:', error);
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 删除失败: ${error.message}`);
				}
			})());
			return c.json({ code: 0 });
		} else if (text.startsWith('删除说说 ')) {
			const title = text.substring(5).trim();
			c.executionCtx.waitUntil((async () => {
				try {
					const results = await searchFilesByTitle(title, c.env.GITHUB_PAT, c.env, 'moments');
					if (results.length === 0) {
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 未找到包含「${title}」的说说`);
						return;
					}
					if (results.length > 1) {
						const list = results.map(r => `• ${r.name} (ID: ${r.docId})`).join('\n');
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `找到多条说说，请精确标题：\n${list}`);
						return;
					}
					const file = results[0];
					await setPendingDelete(c.env, userOpenId, { path: file.path, sha: file.sha, name: file.name, docId: file.docId });
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `确认删除说说《${file.name}》（飞书文档ID: ${file.docId}）？\n回复 Y 确认删除`);
				} catch (error) {
					console.error('删除说说搜索失败:', error);
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 删除失败: ${error.message}`);
				}
			})());
			return c.json({ code: 0 });
		} else if (text.startsWith('删除相册 ')) {
			const title = text.substring(5).trim();
			c.executionCtx.waitUntil((async () => {
				try {
					const results = await searchFilesByTitle(title, c.env.GITHUB_PAT, c.env, 'photos');
					if (results.length === 0) {
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 未找到包含「${title}」的相册`);
						return;
					}
					if (results.length > 1) {
						const list = results.map(r => `• ${r.name}`).join('\n');
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `找到多个相册，请精确标题：\n${list}`);
						return;
					}
					const file = results[0];
					const { owner, contentRepo } = getRepoConfig(c.env);
					const dirResponse = await fetch(`https://api.github.com/repos/${owner}/${contentRepo}/contents/${file.path}`, {
						headers: { 'Authorization': `Bearer ${c.env.GITHUB_PAT}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'feishu-sync-bot' }
					});
					if (!dirResponse.ok) throw new Error(`获取相册目录失败: ${dirResponse.status}`);
					const dirFiles = await dirResponse.json();
					for (const f of dirFiles) {
						await deleteFile(f.path, f.sha, c.env.GITHUB_PAT, c.env);
					}
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `✅ 已删除相册《${file.name}》及其所有图片`);
					await triggerGitHubWorkflow(c.env);
				} catch (error) {
					console.error('删除相册失败:', error);
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 删除失败: ${error.message}`);
				}
			})());
			return c.json({ code: 0 });
		} else if (text.startsWith('同步说说 ')) {
			const documentId = text.substring(5).trim();
			c.executionCtx.waitUntil((async () => {
				try {
					let docId = documentId;
					if (documentId.match(/[一-龥]/)) {
						const token = await getFeishuToken(c.env);
						const docInfo = await findMomentDocumentByTitle(documentId, token, c.env);
						if (!docInfo) {
							if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 未找到包含「${documentId}」的说说文档`);
							return;
						}
						docId = docInfo.document_id;
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `📄 找到说说: ${docInfo.title}，开始同步...`);
					}
					const { msg, status } = await syncMomentById(docId, c.env);
					if (status === 'success') {
						await triggerGitHubWorkflow(c.env);
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `✅ ${msg}\n🚀 已触发博客重新构建。`);
					} else {
						if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `⏭️ ${msg}`);
					}
				} catch (error) {
					console.error('同步说说失败:', error);
					if (userOpenId) await sendFeishuMessage(c.env, userOpenId, `❌ 同步说说失败: ${error.message}`);
				}
			})());
			return c.json({ code: 0 });
		}

		return c.json({ code: 0 });
	} catch (error) {
		console.error('处理事件失败:', error);
		return c.json({ code: 500, message: '服务器错误' }, 500);
	}
});

export default { async fetch(request, env, ctx) { return app.fetch(request, env, ctx); } };
