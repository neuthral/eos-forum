import jQuery from "jquery";

import { EOSBinaryReader } from "@/eosbinaryreader";
import { GetEOS } from "@/eos";
import Helpers from "@/helpers";
import { storage } from "@/storage";
import { moderation } from "@/moderation";

async function GetPostDataFromBlockchain(txid) {
    const eos = GetEOS();
    const tx = await eos.getTransaction(txid);

    var offset = 0;
    var hex = tx.trx.trx.actions[0].data;
    var rdr = new EOSBinaryReader(hex);

    var tx_data = {
        poster: rdr.readName(),
        post_uuid: rdr.readString(),
        content: rdr.readString(),
        reply_to_poster: rdr.readName(),
        reply_to_post_uuid: rdr.readString(),
        certify: rdr.readVarInt(),
        json_metadata: rdr.readString()
    };

    try {
        tx_data.json_metadata = JSON.parse(tx_data.json_metadata);
    } catch (ex) {
        // do nothing
    }

    return tx_data;
}

async function MigratePost(p) {
    if (p.__migrated) {
        return;
    }

    p.__migrated = true;

    await moderation.getCacheSet(p.createdAt);

    if (!p.data.content && !p.data.json_metadata.title) {
        // post has been censored from nsdb api, try to get via bp api
        p.data = await GetPostDataFromBlockchain(p.transaction);
    }

    p.depth = 0;
    p.children = [];

    if (storage.settings.atmos_upvotes) {
        p.up = Math.floor(p.up + (p.up_atmos ? p.up_atmos : 0));
    }

    p.o_transaction = p.transaction;
    p.o_id = p.id;

    if (p.recent_edit) {
        ApplyPostEdit(p, p.recent_edit);
    }

    var attachment = p.data.json_metadata.attachment;
    p.o_attachment = jQuery.extend(true, {}, attachment);

    if (attachment && attachment.value) {
        if (attachment.type == 'ipfs') {
            //
            //  transform ipfs --> url
            //
            attachment.type = 'url';
            attachment.value = 'https://gateway.ipfs.io/ipfs/' + attachment.value;
        }
        else if (attachment.type == 'url') {
            //
            //  transform youtube --> auto embed
            //
            var host = Helpers.GetHost(attachment.value);
            if (host == 'youtu.be') {
                var split = attachment.value.split('/');
                attachment.value = 'https://www.youtube.com/?v=' + split[split.length - 1];
                host = 'youtube.com';
            }
            if (host == 'youtube.com' || host == 'www.youtube.com') {
                var vid = attachment.value.match(/v\=[A-Za-z0-9_\-]+/);
                if (vid && vid.length > 0) {
                    attachment.width = 560;
                    attachment.height = 315;
                    attachment.value = 'https://www.youtube.com/embed/' + vid[0].substring(2);
                    attachment.display = 'iframe';
                }
            }
            if (host == 'i.imgur.com') {
                attachment.display = 'img';
            }
            if (host == 'twitter.com') {
                attachment.value = 'https://twitframe.com/show?url=' + attachment.value;
                attachment.width = 560;
                attachment.height = 400;
                attachment.display = 'iframe';
            }
            if (host == 'd.tube') {
                var vid = attachment.value.indexOf('v/') + 2;
                attachment.value = 'https://emb.d.tube/#!/' + attachment.value.substring(vid);
                attachment.width = 560;
                attachment.height = 400;
                attachment.display = 'iframe';
            }
            if (host == 'soundcloud.com') {
                try {
                    var sc_json = await Helpers.AsyncGet('https://soundcloud.com/oembed?format=json&url=' + attachment.value);
                    var sc_src = sc_json.html.match(/src=\".+\"/);
                    if (sc_src.length > 0) {
                        var sc_iframe = sc_src[0].substring(5);
                        sc_iframe = sc_iframe.substring(0, sc_iframe.length - 1);

                        attachment.value = sc_iframe;
                        attachment.width = 560;
                        attachment.height = 300;
                        attachment.display = 'iframe';
                    }
                }
                catch (sc_ex) {
                    // pass
                }
            }
            if (host == 'bitchute.com' || host == 'www.bitchute.com') {
                var vid = attachment.value.match(/video\/[a-zA-Z0-9]+/);
                if (vid && vid.length > 0) {
                    attachment.width = 560;
                    attachment.height = 315;
                    attachment.value = 'https://www.bitchute.com/embed/' + vid[0].substring(6);
                    attachment.display = 'iframe';
                }
            }
        }

        if (attachment.display == 'iframe') {
            if (!(attachment.width) && !(attachment.height)) {
                attachment.width = 560;
                attachment.height = 315;
            }
        }
    }

    if (p.parent) {
        await MigratePost(p.parent);

        if (p.parent.data.json_metadata) {
            const title = p.parent.data.json_metadata.title;
            p.data.json_metadata.title = title;
        }
    }
}

function ApplyPostEdit(parent, p) {
    // if the edit does not set a title, take title from parent
    if (!(p.data.json_metadata.title)) {
        p.data.json_metadata.title = parent.data.json_metadata.title;
    }

    parent.data.content = p.data.content;
    parent.data.json_metadata = p.data.json_metadata;
    parent.createdAt = p.createdAt;
    parent.transaction = p.transaction;
    parent.id = p.id;
}

export { MigratePost, ApplyPostEdit };