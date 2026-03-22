import React from 'react';
import { Composition, CalculateMetadataFunction } from 'remotion';
import { computeFilmMasterDurationInFrames } from './computeFilmMasterDuration';
import { FilmMaster, FilmTimelineProps } from './compositions/FilmMaster';

export const calculateFilmMetadata: CalculateMetadataFunction<FilmTimelineProps> = ({
  props,
}) => {
  const fps = props.fps && props.fps > 0 ? props.fps : 24;
  return {
    durationInFrames: computeFilmMasterDurationInFrames({
      fps,
      sequences: props.sequences ?? [],
    }),
    fps,
    width: props.width ?? 1920,
    height: props.height ?? 1080,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="FilmMaster"
        component={FilmMaster}
        calculateMetadata={calculateFilmMetadata}
        defaultProps={{
          version: 1,
          fps: 24,
          width: 1920,
          height: 1080,
          projectTitle: '',
          endFadeOutSec: 0,
          sequences: [],
          overlays: [],
        }}
      />
    </>
  );
};
