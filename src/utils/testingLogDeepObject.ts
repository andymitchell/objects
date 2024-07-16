import * as util from 'util';

export default function testingLogDeepObject(object:any, depth = null) {
    return util.inspect(object, {depth: null, colors: true});
}