import { retrieveState, updateState } from '../state.logic';
import { updateCollectionFile } from '../collectionFile';
import BaseTask from './baseTask';

class RankedBeatmapsProcessor extends BaseTask {
	public processRankedBeatmaps = async () => {
		console.log('Process ranked beatmaps start');
		await this.osuService.retrieveToken();
		const state = await retrieveState();
		let [beatmaps, lastDate, lastBeatmapset, beatmapsLeft] = await this.osuService.retrieveRankedBeatmaps(state!.lastDate, state!.lastBeatmapset);
		while (beatmapsLeft || beatmaps.length > 0) {
			this.promiseQueue
				.addAll(
					beatmaps.map(beatmap => async () => {
						try {
							await this.processBeatmap(beatmap);
						} catch (error) {
							console.log(error);
						}
					})
				)
				.catch(error => console.log(error));
			await this.promiseQueue.onIdle();
			await updateState(lastDate, lastBeatmapset);
			[beatmaps, lastDate, lastBeatmapset, beatmapsLeft] = await this.osuService.retrieveRankedBeatmaps(lastDate, lastBeatmapset);
		}
		await updateCollectionFile();
		console.log('Process ranked beatmaps end');
	};
}

export default RankedBeatmapsProcessor;
