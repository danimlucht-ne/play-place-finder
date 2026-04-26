/* eslint-disable no-console */
// One-off tool to restructure the Postman collection (folders + alpha sort) while preserving
// the exact request object graphs by reference.

const fs = require('fs');
const path = require('path');

const COLLECTION_PATH = path.join(__dirname, '..', 'PlaygroundFinder.postman_collection.json');
const IN_PATH = process.argv[2] ? path.resolve(process.argv[2]) : COLLECTION_PATH;
const OUT_PATH = process.argv[3] ? path.resolve(process.argv[3]) : IN_PATH;

const TOP_LEVEL_ORDER = ['Admin', 'Ads', 'Auth', 'Discounts', 'Health', 'Playgrounds', 'Regions', 'Support', 'Users'];

function isRequest(node) {
    return node && typeof node === 'object' && node.request;
}

function sortItemsAlpha(items) {
    return [...(items || [])].sort((a, b) => {
        const an = String(a?.name || '');
        const bn = String(b?.name || '');
        return an.localeCompare(bn, 'en', { sensitivity: 'base' });
    });
}

function findFolderFlat(items, name) {
    for (const it of items || []) {
        if (it && it.name === name) return it;
    }
    return null;
}

function getOrCreateFolder(rootItems, name) {
    let f = findFolderFlat(rootItems, name);
    if (f) return f;
    f = { name, item: [] };
    rootItems.push(f);
    return f;
}

function getOrCreateChildFolder(parentFolder, name) {
    parentFolder.item = parentFolder.item || [];
    return getOrCreateFolder(parentFolder.item, name);
}

/**
 * @param {any[]} fromItems
 * @param {string} requestName
 */
function takeRequestByName(fromItems, requestName) {
    for (let i = 0; i < (fromItems || []).length; i += 1) {
        const it = fromItems[i];
        if (!it) continue;
        if (isRequest(it) && it.name === requestName) {
            return fromItems.splice(i, 1)[0];
        }
    }
    return null;
}

/**
 * @param {any[]} fromItems
 * @param {string} folderName
 * @param {string} [requestName]
 */
function takeFolderByName(fromItems, folderName, requestName) {
    for (let i = 0; i < (fromItems || []).length; i += 1) {
        const it = fromItems[i];
        if (!it) continue;
        if (!it.item) continue; // not a folder
        if (it.name !== folderName) continue;
        if (requestName) {
            const hasReq = (it.item || []).some((x) => isRequest(x) && x.name === requestName);
            if (!hasReq) continue;
        }
        return fromItems.splice(i, 1)[0];
    }
    return null;
}

/**
 * @param {any} folder
 * @param {any[]} targetItems
 * @param {string[]} [onlyNames] If provided, only those request names.
 */
function moveAllRequestsFromFolder(folder, targetItems, onlyNames) {
    if (!folder) return 0;
    const names = new Set((onlyNames || []).filter(Boolean));
    const wantAll = !onlyNames || onlyNames.length === 0;
    const src = folder.item || [];
    let moved = 0;
    for (let i = src.length - 1; i >= 0; i -= 1) {
        const it = src[i];
        if (!isRequest(it)) continue;
        if (!wantAll && !names.has(it.name)) continue;
        targetItems.push(src.splice(i, 1)[0]);
        moved += 1;
    }
    return moved;
}

/**
 * @param {any} folder
 * @param {any[]} outMissing
 * @param {string} [desc]
 */
function assertFolderEmptyOrReport(folder, outMissing, desc) {
    if (!folder) {
        return;
    }
    const left = (folder.item || []).filter((x) => isRequest(x));
    for (const r of left) {
        outMissing.push(
            `Expected folder cleared but found request "${r.name || ''}"` + (desc ? ` (${desc})` : ''),
        );
    }
    const subfolders = (folder.item || []).filter((x) => x && x.item);
    for (const sf of subfolders) {
        if ((sf.item || []).length) {
            outMissing.push(
                `Non-empty subfolder under "${folder.name}": "${sf.name}"` + (desc ? ` (${desc})` : ''),
            );
        }
    }
}

function readJson() {
    const buf = fs.readFileSync(IN_PATH, 'utf8');
    // Strip BOM if present
    return JSON.parse(buf.replace(/^\uFEFF/, ''));
}

function writeJson(data) {
    // Ensure no BOM, stable formatting.
    const text = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(OUT_PATH, text, 'utf8');
}

function main() {
    const collection = readJson();

    if (!Array.isArray(collection.item)) {
        throw new Error('Invalid collection: missing `item` array');
    }

    // Capture references from old top-level
    const old = collection.item;
    const missing = [];
    const movedSummary = [];

    // Helper to find old top-level by name
    const oldByName = (n) => findFolderFlat(old, n);

    // --- Rebrand collection metadata to match current app naming.
    if (typeof collection?.info?.name === 'string') {
        if (collection.info.name.includes('Playground Finder') || collection.info.name.includes('Play Place')) {
            collection.info.name = 'Play Spotter API';
        }
    }
    if (typeof collection?.info?.description === 'string') {
        // Replace common mojibake sequences; keep it ASCII and neutral.
        collection.info.description = collection.info.description
            .replaceAll('Play Place Finder', 'Play Spotter')
            .replaceAll('play-place', 'play-spotter');
    }

    // --- New root container (will replace)
    const root = [];

    const admin = getOrCreateFolder(root, 'Admin');
    const ads = getOrCreateFolder(root, 'Ads');
    const auth = getOrCreateFolder(root, 'Auth');
    const discounts = getOrCreateFolder(root, 'Discounts');
    const health = getOrCreateFolder(root, 'Health');
    const playgrounds = getOrCreateFolder(root, 'Playgrounds');
    const regions = getOrCreateFolder(root, 'Regions');
    const support = getOrCreateFolder(root, 'Support');
    // NOTE: do not pre-create `Users` here; it can collide with an existing top-level "Users" folder.

    // Admin subfolders
    const adminMod = getOrCreateChildFolder(admin, 'Moderation');
    const adminSup = getOrCreateChildFolder(admin, 'Support');
    const adminUsers = getOrCreateChildFolder(admin, 'Users');
    const adminPgs = getOrCreateChildFolder(admin, 'Playgrounds');
    const adminRegions = getOrCreateChildFolder(admin, 'Regions');
    const adminSystem = getOrCreateChildFolder(admin, 'System');

    // Ads subfolders
    const adsAdmin = getOrCreateChildFolder(ads, 'Admin');
    const adsClient = getOrCreateChildFolder(ads, 'Client');

    // Discounts subfolders
    const discountsAdmin = getOrCreateChildFolder(discounts, 'Admin');
    const discountsClient = getOrCreateChildFolder(discounts, 'Client');

    // --- 1) Users: normalize "User" -> "Users" and attach into `root` (must run before other top-level moves)
    {
        const uLegacy = findFolderFlat(old, 'User');
        const uNew = findFolderFlat(old, 'Users');
        if (uLegacy) {
            uLegacy.name = 'Users';
        }
        const u = uLegacy || uNew;
        if (u) {
            const target = getOrCreateFolder(root, 'Users');
            target.item = u.item || [];
            const i = old.findIndex((x) => x && (x.name === 'User' || x.name === 'Users'));
            if (i >= 0) old.splice(i, 1);
        } else {
            missing.push('Missing "User" / "Users" folder');
        }
    }

    // --- 2) Move static top-level folders
    {
        // Auth, Health, Regions, Support are already correct categories.
        for (const name of ['Auth', 'Health', 'Regions', 'Support']) {
            const f = findFolderFlat(old, name);
            if (!f) {
                missing.push(`Missing top-level folder: ${name}`);
                continue;
            }
            const target = getOrCreateFolder(root, name);
            target.item = f.item || [];
            const i = old.findIndex((x) => x && x.name === name);
            if (i >= 0) old.splice(i, 1);
        }
    }

    // --- 3) Playgrounds: start from "Playgrounds" and add "Ratings & Verification" + "Seed"
    {
        const pg = findFolderFlat(old, 'Playgrounds');
        if (pg) {
            playgrounds.item = pg.item || [];
            const i = old.findIndex((x) => x && x.name === 'Playgrounds');
            if (i >= 0) old.splice(i, 1);
        } else {
            missing.push('Missing "Playgrounds" folder');
        }

        const rnv = findFolderFlat(old, 'Ratings & Verification');
        if (rnv) {
            moveAllRequestsFromFolder(rnv, playgrounds.item);
            assertFolderEmptyOrReport(rnv, missing, 'after moving Ratings & Verification -> Playgrounds');
            const i = old.findIndex((x) => x && x.name === 'Ratings & Verification');
            if (i >= 0) old.splice(i, 1);
        } else {
            missing.push('Missing "Ratings & Verification" folder');
        }

        const seed = findFolderFlat(old, 'Seed');
        if (seed) {
            moveAllRequestsFromFolder(seed, playgrounds.item);
            const i2 = findFolderFlat(playgrounds.item, 'Search');
            const search = i2 && i2.item ? i2 : null;
            if (search) {
                // no-op, handled below by sorting/optional grouping; keep flat for now
            }
            const i = old.findIndex((x) => x && x.name === 'Seed');
            if (i >= 0) old.splice(i, 1);
        } else {
            missing.push('Missing "Seed" folder');
        }
    }

    // Optional: add a "Search" subfolder under Playgrounds to keep search-ish endpoints grouped
    {
        const search = getOrCreateChildFolder(playgrounds, 'Search');
        const toMove = ['Hybrid Search (triggers city seed)'];
        for (const n of toMove) {
            const r = takeRequestByName(playgrounds.item, n);
            if (r) search.item.push(r);
        }
    }

    // City completion: move to Regions (public) instead of being buried in playgrounds
    {
        const cc = takeRequestByName(playgrounds.item, 'City Completion Meter');
        if (cc) regions.item.push(cc);
    }

    // --- 4) Admin: decompose the giant flat list
    {
        const a = findFolderFlat(old, 'Admin');
        if (!a) {
            missing.push('Missing "Admin" folder');
        } else {
            // Start from a shallow copy: remove folder node from old, then distribute children.
            const i0 = old.findIndex((x) => x && x.name === 'Admin');
            if (i0 >= 0) old.splice(i0, 1);

            const children = a.item || [];

            const modNames = new Set(
                [
                    'Get Moderation Queue',
                    'Approve Moderation Item',
                    'Reject Moderation Item',
                    'Approve Edit',
                    'Reject Edit',
                    'Approve Photo',
                    'Reject Photo',
                ],
            );
            const supNames = new Set(
                [
                    'Get Support Tickets',
                    'Resolve Support Ticket',
                    'Approve Support Suggestion (apply to place + options)',
                    'Reject Support Ticket',
                ],
            );
            const userNames = new Set(
                [
                    'Block User (submission lock)',
                    'Unblock User',
                    'Set User Manual Review (on/off)',
                ],
            );
            const pgNames = new Set(
                [
                    'Admin Delete Playground',
                    'Bulk Region Tag (dry run)',
                    'Bulk Region Tag (apply)',
                    'Recategorize Types (dry run, seeded)',
                    'Recategorize Types (apply, seeded)',
                    'Get Playground Change Audit',
                    'Rollback One Audit Entry',
                    'Rollback By User (dry run)',
                    'Rollback By User (apply)',
                ],
            );
            const regNames = new Set(
                [
                    'Backfill - Seed Verification Dates',
                    'Backfill - Seed Cost Range',
                    'Backfill Seed Cost (Overwrite All)',
                    'Debug - Inspect Playgrounds Sample',
                    'Seed Review - List Regions',
                    'Seed Review - Get Items',
                    'Seed Review - Approve Photo',
                    'Seed Review - Reject Photo',
                    'Expand Region(s)',
                    'Expand All Regions',
                    'Reseed Region',
                    'Reseed All Regions',
                    'Trim Photo Galleries',
                    'List Seeded Regions',
                    'Seed New Region',
                    'Delete Seeded Region',
                    'Merge Region (dedup + sub-venues)',
                    'Merge Preview (dedup + campus + address sub-venues, dry run)',
                    'Link Sub-Venues',
                    'Unlink Sub-Venue',
                ],
            );
            const supMiscNames = new Set(
                [
                    'Get Pending Category Suggestions',
                    'Approve Category Suggestion',
                ],
            );
            const discAdminNames = new Set(
                [
                    'Admin - Create Discount Code',
                    'Admin - List All Discount Codes',
                    'Admin - Update Discount Code',
                    'Admin - Deactivate Discount Code',
                    'Admin - Get Redemption History',
                ],
            );
            const systemNames = new Set(
                [
                    'Server logs (tail, text)',
                ],
            );
            const trendsAwards = new Set(
                [
                    'Trends - Daily',
                    'Trends - Top Contributors',
                    'Trends - City Growth',
                    'Run Monthly Awards',
                ],
            );

            for (const ch of children) {
                if (!isRequest(ch)) {
                    missing.push(`Unexpected nested folder in Admin: ${ch?.name || 'unknown'}`);
                    continue;
                }
                const n = ch.name;
                if (modNames.has(n)) adminMod.item.push(ch);
                else if (supNames.has(n)) adminSup.item.push(ch);
                else if (userNames.has(n)) adminUsers.item.push(ch);
                else if (pgNames.has(n)) adminPgs.item.push(ch);
                else if (regNames.has(n)) adminRegions.item.push(ch);
                else if (supMiscNames.has(n)) adminSup.item.push(ch);
                else if (discAdminNames.has(n)) discountsAdmin.item.push(ch);
                else if (trendsAwards.has(n)) adminSystem.item.push(ch);
                else if (systemNames.has(n)) adminSystem.item.push(ch);
                else {
                    // Put unknowns into system with a clear marker
                    ch.name = `${n} (unmapped)`;
                    adminSystem.item.push(ch);
                }
            }
        }
    }

    // --- 5) Ads: take old "Admin — ads (review & ops)" folder, normalize name
    {
        // Try a few name variants in case mojibake
        const candidates = [
            'Admin \u2014 ads (review & ops)',
            'Admin — ads (review & ops)',
            'Admin â€” ads (review & ops)',
            'Admin  ads (review & ops)',
        ];
        let adsFolder = null;
        for (const c of candidates) {
            const f = findFolderFlat(old, c);
            if (f) {
                adsFolder = f;
                break;
            }
        }
        if (!adsFolder) {
            // last resort: scan
            for (const x of old) {
                if (!x) continue;
                if (!x.item) continue;
                if (String(x.name || '').includes('ads (review & ops)')) {
                    adsFolder = x;
                    break;
                }
            }
        }
        if (adsFolder) {
            const i = old.findIndex((x) => x === adsFolder);
            if (i >= 0) old.splice(i, 1);
            // Move children into adsAdmin, sorted later
            adsAdmin.item = adsFolder.item || [];
        } else {
            missing.push('Missing legacy Admin ads folder');
        }
    }

    // --- 6) Discounts: split the old "Discount Codes" top-level, drop nested "Admin — region seed & ad analytics" folder
    {
        const d = findFolderFlat(old, 'Discount Codes');
        if (!d) {
            missing.push('Missing "Discount Codes" top-level');
        } else {
            // Remove d from old for processing
            const i = old.findIndex((x) => x && x.name === 'Discount Codes');
            if (i >= 0) old.splice(i, 1);

            // direct requests that belong to client discounts
            for (const ch of d.item || []) {
                if (isRequest(ch) && (ch.name === 'Validate Discount Code' || ch.name === 'Free Submission (100% discount)')) {
                    discountsClient.item.push(ch);
                }
            }

            // If admin discount items were moved earlier from Admin, we might not see them here.
            // If still here, also capture admin discount requests
            for (const ch of d.item || []) {
                if (isRequest(ch) && ch.name && ch.name.startsWith('Admin - ')) {
                    discountsAdmin.item.push(ch);
                }
            }

            const nested = (d.item || []).find(
                (x) => x && x.item && String(x.name || '').toLowerCase().includes('region seed') && x.name.toLowerCase().includes('ad analytics'),
            );
            if (nested) {
                // Some variant name:
                // "Admin \u2014 region seed & ad analytics"
            }
            if (!nested) {
                for (const x of d.item || []) {
                    if (x && x.item && (String(x.name || '').includes('region seed') || String(x.name || '').includes('ad analytics'))) {
                        // pick the likely nested mix folder
                    }
                }
            }

            // Re-find by scanning
            const nested2 = (d.item || []).find(
                (x) =>
                    x &&
                    x.item &&
                    /region seed/i.test(String(x.name || '')) &&
                    /ad analytics/i.test(String(x.name || '')),
            );

            if (nested2) {
                const regSeedNames = new Set(
                    [
                        'GET last viewport seed preview (candidate list)',
                        'POST seed viewport (map bounds)',
                        'POST expand region (+10 mi coverage crawl)',
                        'POST lightweight re-seed (center grid, upserts only)',
                        'POST full reseed region (destructive; clears playgrounds for region)',
                    ],
                );
                const adsAnalyticNames = new Set(
                    [
                        'GET my campaigns (analytics list)',
                        'GET campaign detail analytics',
                        'POST ad event (impression or click)',
                    ],
                );
                for (const ch of nested2.item || []) {
                    if (!isRequest(ch)) {
                        missing.push(`Unexpected non-request under mixed discounts folder: ${ch?.name}`);
                        continue;
                    }
                    if (regSeedNames.has(ch.name)) {
                        // Put under Admin > Regions as "Ad Router Region Seeding" group to reflect server mount at /admin/ads/regions/*
                        const g = getOrCreateChildFolder(adminRegions, 'Ad router (/admin/ads/regions/...)');
                        g.item.push(ch);
                    } else if (adsAnalyticNames.has(ch.name)) {
                        // Client ad analytics/tracking: keep under Ads/Client
                        const g = getOrCreateChildFolder(adsClient, 'Analytics & Events');
                        g.item.push(ch);
                    } else {
                        ch.name = `${ch.name} (unmapped from mixed discount folder)`;
                        const g = getOrCreateChildFolder(adsClient, 'Unmapped');
                        g.item.push(ch);
                    }
                }
            } else {
                missing.push('Missing mixed "region seed & ad analytics" nested folder under Discount Codes');
            }
        }
    }

    // --- 7) Ensure we consumed old Admin leftovers (none expected)

    // --- 8) Sort + assemble final `collection.item` in the desired top-level order
    function sortFolderTree(folder) {
        if (!folder || !folder.item) return;
        // first sort requests at this level, then subfolders' children
        const items = folder.item;
        const reqs = items.filter((x) => isRequest(x));
        const subs = items.filter((x) => x && x.item);
        for (const s of subs) sortFolderTree(s);
        folder.item = sortItemsAlpha([...subs, ...reqs]);
    }

    const users = findFolderFlat(root, 'Users');

    // sort each major folder tree
    for (const f of [admin, ads, discounts, playgrounds, regions, users, auth, support, health]) {
        sortFolderTree(f);
    }
    for (const f of [adminMod, adminSup, adminUsers, adminPgs, adminRegions, adminSystem, adsAdmin, adsClient, discountsAdmin, discountsClient]) {
        sortFolderTree(f);
    }

    // Rebuild in explicit order, appending any unmatched leftovers
    const rebuilt = [];
    for (const name of TOP_LEVEL_ORDER) {
        const f = findFolderFlat(root, name);
        if (f) rebuilt.push(f);
    }

    if (old.length) {
        console.error('FATAL: Unprocessed top-level nodes remain from original collection:');
        for (const x of old) {
            console.error(' - ' + (x && x.name));
        }
        throw new Error('Postman reorg stopped: unprocessed top-level nodes remain (would duplicate requests).');
    }

    collection.item = rebuilt;

    writeJson(collection);
    console.log('OK: wrote', OUT_PATH);
    if (missing.length) {
        console.warn('WARN: missing/assumption issues:');
        for (const m of missing) console.warn(' - ' + m);
    }
}

try {
    main();
} catch (e) {
    console.error('FAILED:', e);
    process.exit(1);
}
